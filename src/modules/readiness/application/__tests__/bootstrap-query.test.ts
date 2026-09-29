import { describe, expect, it, vi } from 'vitest';
import { queryReadinessBootstrap, readReadinessFeatureFlags } from '../bootstrap-query';
import { PrismaAuditRepository } from '../../infrastructure/audit/audit-repository';
import { TECH_READINESS_FLAGS, TECH_READINESS_USERS } from '../../../../../tests/fixtures/tech-readiness.fixture';

function transaction() {
  // Цепочка аудита пишется той же транзакцией, а цепочечный писатель —
  // настоящий (`appendAuditEvent`): строка получает номер и хеш звена, поэтому
  // транзакция обязана уметь всё, что нужно проверке цепочки.
  const auditRows: Array<Record<string, unknown>> = [];
  const chain = { lastSequence: BigInt(0), headHash: null as Uint8Array | null };
  const tx = {
    tenantSettings: {
      findUnique: vi.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
    equipment: {
      findMany: vi.fn().mockResolvedValue([{ id: 'eq-a', name: 'Rig A', model: 'M1' }]),
      count: vi.fn().mockResolvedValue(1),
    },
    site: {
      findMany: vi.fn().mockResolvedValue([{ id: 'site-a', name: 'Site A' }]),
      count: vi.fn().mockResolvedValue(1),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'mechanic-a', name: 'Mechanic A', role: 'MECHANIC' },
      ]),
    },
    crew: { count: vi.fn().mockResolvedValue(1) },
    readinessRuleSet: { count: vi.fn().mockResolvedValue(1) },
    // Матрица доступов читается той же транзакцией. Пусто — действуют значения
    // по умолчанию из кода, то есть проверки ниже описывают прежнее поведение.
    readinessAccessMatrix: { findFirst: vi.fn().mockResolvedValue(null) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return data;
      }),
      // Заглушка отвечает по последней записанной строке — так проверка смены
      // режима (F-R34-19) работает на настоящих данных, а не на заглушке.
      findFirst: vi.fn(async ({ where }: {
        where: { tenantId: string; userId: string; action: string };
      }) => {
        const row = auditRows.filter((item) => item.tenantId === where.tenantId
          && item.userId === where.userId && item.action === where.action).at(-1);
        return row ? { after: row.after } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; hash: { not: null } } }) =>
        auditRows
          .filter((row) => row.tenantId === where.tenantId && row.hash != null)
          .sort((left, right) => Number((left.sequence as bigint) - (right.sequence as bigint)))),
    },
    tenantAuditChain: {
      findUnique: vi.fn(async () => ({ lastSequence: chain.lastSequence, headHash: chain.headHash })),
      updateMany: vi.fn(async ({ data }: { data: { lastSequence: bigint; headHash: Uint8Array } }) => {
        chain.lastSequence = data.lastSequence;
        chain.headHash = data.headHash;
        return { count: 1 };
      }),
    },
    $queryRaw: vi.fn(async () => [{ lastSequence: chain.lastSequence, headHash: chain.headHash }]),
    $executeRaw: vi.fn(async () => 1),
  };
  return Object.assign(tx, { auditRows });
}

describe('readiness bootstrap query', () => {
  it('enables the approved readiness workflows by default and supports an explicit kill switch', () => {
    expect(readReadinessFeatureFlags({})).toEqual({
      readiness_shifts_v1: true,
      readiness_permits_v1: true,
      readiness_audit_chain_v1: true,
    });
    expect(readReadinessFeatureFlags({ READINESS_SHIFTS_V1: 'false' }).readiness_shifts_v1).toBe(false);
  });

  it('returns real tenant settings, flags, selectors, counts and mechanic capabilities', async () => {
    const tx = transaction();
    const result = await queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.mechanic,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS)
    );

    expect(result.tenant).toEqual({ timezone: 'Europe/Moscow' });
    expect(result.featureFlags).toEqual({
      readiness_shifts_v1: true,
      readiness_permits_v1: true,
      readiness_audit_chain_v1: false,
    });
    expect(result.selectors.equipment).toHaveLength(1);
    expect(result.counts).toMatchObject({ equipment: 1, sites: 1, activeCrews: 1 });
    expect(result.capabilities.entities.shift.manage).toBe(false);
    expect(result.capabilities.entities.shift.decideHandover).toBe(false);
    expect(result.capabilities.entities.maintenance.manage).toBe(true);
  });

  it('persists an ADMIN actingAs MECHANIC audit and returns the effective capabilities', async () => {
    const tx = transaction();
    const result = await queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.admin,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS),
      'MECHANIC',
      'request-1'
    );

    expect(tx.auditLog.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: TECH_READINESS_USERS.admin.tenantId,
        userId: TECH_READINESS_USERS.admin.id,
        action: 'acting_as_mechanic',
      },
      orderBy: { timestamp: 'desc' },
      select: { after: true },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    // Строка идёт через цепочку: номер, предыдущий хеш и хеш звена на месте —
    // иначе единственный читатель журнала (`hash: {not: null}`) её не увидит.
    const row = tx.auditRows[0];
    expect(row).toMatchObject({
      entity: 'ReadinessActor',
      entityType: 'ReadinessActor',
      action: 'acting_as_mechanic',
      entityId: TECH_READINESS_USERS.admin.id,
      userRole: 'ADMIN',
      actingAs: 'MECHANIC',
      userId: TECH_READINESS_USERS.admin.id,
      userName: TECH_READINESS_USERS.admin.name,
      tenantId: TECH_READINESS_USERS.admin.tenantId,
      requestId: 'request-1',
      after: { actualRole: 'ADMIN', actingAs: 'MECHANIC' },
    });
    expect(row.sequence).toBe(BigInt(1));
    expect(row.hash).toBeInstanceOf(Uint8Array);
    const { events } = await new PrismaAuditRepository(tx as never)
      .readChain(TECH_READINESS_USERS.admin.tenantId);
    expect(events.map((event) => event.action)).toEqual(['acting_as_mechanic']);
    expect(result.actor.actingAs).toBe('MECHANIC');
    expect(result.capabilities.entities.maintenance.manage).toBe(true);
    // Права администратора в режиме механика НЕ сохраняются: «Действую как
    // механик» — это исполнение роли, а не добавка к своей. Раньше здесь стояло
    // `true`, и проверка закрепляла ошибку: из режима механика оставался доступ
    // к настройке правил и матрицы доступов.
    expect(result.capabilities.entities.rules.manage).toBe(false);
  });

  it('пишет строку замещения только на смену режима, а не на каждую загрузку раздела (F-R34-19)', async () => {
    const tx = transaction();
    const bootstrap = (actingAs: 'MECHANIC' | 'FOREMAN' | null) => queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.admin,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS),
      actingAs,
      'request-1'
    );

    await bootstrap('MECHANIC');
    await bootstrap('MECHANIC');

    // Повторный вход в раздел в том же режиме следа не оставляет: иначе на
    // каждой загрузке экрана в журнале появлялась бы ещё одна строка.
    expect(tx.auditRows).toHaveLength(1);

    await bootstrap('FOREMAN');

    expect(tx.auditRows).toHaveLength(2);
    expect(tx.auditRows[1]).toMatchObject({
      action: 'acting_as_mechanic',
      actingAs: 'FOREMAN',
      after: { actualRole: 'ADMIN', actingAs: 'FOREMAN' },
    });
    expect(tx.auditRows[1].sequence).toBe(BigInt(2));
  });

  it('rejects non-admin actingAs without writing an audit', async () => {
    const tx = transaction();
    await expect(queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.dispatcher,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS),
      'MECHANIC'
    )).rejects.toMatchObject({ status: 403 });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('scopes every selector/count query to the session tenant and leaks no foreign identifier', async () => {
    const tx = transaction();
    const result = await queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.admin,
      {
        readiness_shifts_v1: false,
        readiness_permits_v1: false,
        readiness_audit_chain_v1: false,
      }
    );
    const tenantId = TECH_READINESS_USERS.admin.tenantId;

    expect(tx.tenantSettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId } })
    );
    expect(tx.equipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }) })
    );
    expect(tx.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }) })
    );
    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId, isActive: true }) })
    );
    expect(tx.crew.count).toHaveBeenCalledWith({
      where: { isActive: true, equipment: { tenantId } },
    });
    expect(JSON.stringify(result)).not.toContain('test-tenant-readiness-foreign');
    expect(result.tenant).not.toHaveProperty('id');
  });

  it('fails closed when tenant settings are missing or the role is unsupported', async () => {
    const missingSettings = transaction();
    missingSettings.tenantSettings.findUnique.mockResolvedValue(null);
    await expect(queryReadinessBootstrap(
      missingSettings as never,
      TECH_READINESS_USERS.admin
    )).rejects.toMatchObject({ status: 503 });

    await expect(queryReadinessBootstrap(
      transaction() as never,
      { ...TECH_READINESS_USERS.admin, role: 'OWNER' }
    )).rejects.toMatchObject({ status: 403 });
  });

  it('uses the organization default when a legacy timezone value is invalid', async () => {
    const tx = transaction();
    tx.tenantSettings.findUnique.mockResolvedValue({ timezone: '(UTC+3) Moscow' });

    const result = await queryReadinessBootstrap(tx as never, TECH_READINESS_USERS.admin);

    expect(result.tenant.timezone).toBe('Europe/Moscow');
  });
});
