import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_READINESS_RULES } from '../../domain/readiness-rules';
import { PrismaAuditRepository } from '../../infrastructure/audit/audit-repository';

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock('@/lib/db', () => ({ db: mocks.db }));

import { publishReadinessRules, saveReadinessDraft } from '../readiness-rules-service';

const tenantId = 'tenant-a';
const actor = { id: 'admin-1', name: 'Администратор', role: 'ADMIN' };

type RuleSetRow = {
  id: string; tenantId: string; status: string; version: string;
  criteria: unknown; blockers: unknown;
  updatedAt: Date; updatedBy: string | null; publishedAt: Date | null;
};

/**
 * Постановка заменяет и `db`, и транзакцию: цепочка аудита пишется той же
 * транзакцией, что и публикация. Цепочечный писатель настоящий — строка
 * проходит через `appendAuditEvent`, получая номер, предыдущий хеш и хеш звена.
 */
function installDb(rows: RuleSetRow[]) {
  const auditRows: Array<Record<string, unknown>> = [];
  const chain = { lastSequence: BigInt(0), headHash: null as Uint8Array | null };
  const readinessRuleSet = {
    findMany: async ({ where }: { where: { tenantId: string; status: { in: string[] } } }) =>
      rows.filter((row) => row.tenantId === where.tenantId && where.status.in.includes(row.status)),
    findFirst: async ({ where }: { where: { tenantId: string; status?: string } }) =>
      rows.find((row) => row.tenantId === where.tenantId
        && (where.status === undefined || row.status === where.status)) ?? null,
    create: async ({ data }: { data: Omit<RuleSetRow, 'id' | 'updatedAt'> }) => {
      const row = { id: `rules-${rows.length + 1}`, updatedAt: new Date(), ...data } as RuleSetRow;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<RuleSetRow> }) => {
      const row = rows.find((item) => item.id === where.id) as RuleSetRow;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: { tenantId: string; status: string }; data: Partial<RuleSetRow> }) => {
      let count = 0;
      for (const row of rows) {
        if (row.tenantId === where.tenantId && row.status === where.status) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };
  // Поиск черновика должен идти той же транзакцией под advisory-замком: чтение
  // через глобальный `db` (в обход замка) — ровно та гонка, ради которой замок
  // берётся (F-R38-10). Вызов вне транзакции помечаем отдельной заглушкой.
  const dbFindFirst = vi.fn(async () => null);
  const txFindFirst = vi.fn(readinessRuleSet.findFirst);
  const tx = {
    readinessRuleSet: { ...readinessRuleSet, findFirst: txFindFirst },
    equipment: { findMany: vi.fn(async () => []) },
    outboxEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return data;
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
  const client = {
    ...tx,
    readinessRuleSet: { ...readinessRuleSet, findFirst: dbFindFirst },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(tx)),
  };
  for (const key of Object.keys(mocks.db)) delete mocks.db[key];
  Object.assign(mocks.db, client);
  return { rows, auditRows, client, tx, dbFindFirst };
}

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

describe('readiness rules audit trail', () => {
  it('saves the draft through the chained writer so the entry reaches the journal', async () => {
    // Набор правил, собранный из запроса, всегда несёт ключи `updatedAt` и
    // `updatedBy` со значением `undefined` — прямая цепочечная запись на них падала.
    const { auditRows } = installDb([]);

    await saveReadinessDraft(tenantId, { criteria: [] }, actor);

    expect(auditRows).toHaveLength(1);
    const data = auditRows[0];
    expect(data.sequence).toBe(BigInt(1));
    expect(data.hash).toBeInstanceOf(Uint8Array);
    expect(data.action).toBe('draft_saved');
    expect(data.entity).toBe('ReadinessRuleSet');
    expect(data.entityType).toBe('ReadinessRuleSet');
    expect(data.tenantId).toBe(tenantId);
    expect(data.userName).toBe(actor.name);
    expect(data.userRole).toBe('ADMIN');
    expect(data.after).toMatchObject({ updatedAt: null, updatedBy: null });
  });

  it('publishes the rules through the chained writer and keeps the entry readable', async () => {
    const { auditRows, client } = installDb([
      {
        id: 'rules-published', tenantId, status: 'PUBLISHED', version: 'v1.0',
        criteria: DEFAULT_READINESS_RULES.criteria, blockers: DEFAULT_READINESS_RULES.blockers,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'), updatedBy: null, publishedAt: null,
      },
      {
        id: 'rules-draft', tenantId, status: 'DRAFT', version: 'v1.1',
        criteria: DEFAULT_READINESS_RULES.criteria, blockers: DEFAULT_READINESS_RULES.blockers,
        updatedAt: new Date('2026-09-02T00:00:00.000Z'), updatedBy: actor.id, publishedAt: null,
      },
    ]);

    await publishReadinessRules(tenantId, actor);

    expect(auditRows).toHaveLength(1);
    const data = auditRows[0];
    expect(data.sequence).toBe(BigInt(1));
    expect(data.hash).toBeInstanceOf(Uint8Array);
    expect(data.action).toBe('published');
    expect(data.entity).toBe('ReadinessRuleSet');
    expect(data.entityId).toBe('rules-draft');
    expect(data.before).toMatchObject({ version: 'v1.0', updatedBy: null });

    const { events } = await new PrismaAuditRepository(client as never).readChain(tenantId);
    expect(events.map((event) => event.action)).toEqual(['published']);
  });

  it('берёт advisory-замок на черновик организации раньше чтения и записи (F-R38-10)', async () => {
    // Замок — первый оператор внутри транзакции, чтение черновика и его запись
    // идут под ним; глобальный клиент в поиске черновика не участвует.
    const { tx, dbFindFirst } = installDb([]);

    await saveReadinessDraft(tenantId, { criteria: [] }, actor);

    const call = tx.$executeRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual([`readiness-draft:rules:${tenantId}`]);
    // Замок — до чтения черновика, и не через $queryRaw: колонка void ломает
    // десериализацию.
    expect(tx.$executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.readinessRuleSet.findFirst.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.calls.filter((c) => sqlOf(c as unknown[]).includes('pg_advisory'))).toEqual([]);
    expect(dbFindFirst).not.toHaveBeenCalled();
  });

  it('публикует правила под тем же замком, читая черновик внутри транзакции (F-R38-10)', async () => {
    const { tx, dbFindFirst } = installDb([
      {
        id: 'rules-published', tenantId, status: 'PUBLISHED', version: 'v1.0',
        criteria: DEFAULT_READINESS_RULES.criteria, blockers: DEFAULT_READINESS_RULES.blockers,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'), updatedBy: null, publishedAt: null,
      },
      {
        id: 'rules-draft', tenantId, status: 'DRAFT', version: 'v1.1',
        criteria: DEFAULT_READINESS_RULES.criteria, blockers: DEFAULT_READINESS_RULES.blockers,
        updatedAt: new Date('2026-09-02T00:00:00.000Z'), updatedBy: actor.id, publishedAt: null,
      },
    ]);

    await publishReadinessRules(tenantId, actor);

    const call = tx.$executeRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual([`readiness-draft:rules:${tenantId}`]);
    // Замок — до чтения черновика, и не через $queryRaw: колонка void ломает
    // десериализацию.
    expect(tx.$executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.readinessRuleSet.findFirst.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.calls.filter((c) => sqlOf(c as unknown[]).includes('pg_advisory'))).toEqual([]);
    expect(dbFindFirst).not.toHaveBeenCalled();
  });
});
