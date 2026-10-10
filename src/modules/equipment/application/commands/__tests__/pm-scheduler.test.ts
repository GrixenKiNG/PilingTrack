import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findManyMock, findFirstMock, createMock, executeRawMock, queryRawMock, dbFindFirstMock,
  readinessMock, transactionMock, auditMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findFirstMock: vi.fn(),
  createMock: vi.fn(),
  // Дедуп и вставка наряда идут в одной транзакции под advisory-замком
  // pg_advisory_xact_lock — см. F-R38-6. Замок возвращает void, поэтому берётся
  // через $executeRaw: $queryRaw падает на десериализации колонки void.
  executeRawMock: vi.fn(),
  queryRawMock: vi.fn(),
  dbFindFirstMock: vi.fn(),
  readinessMock: vi.fn(),
  transactionMock: vi.fn(),
  auditMock: vi.fn(),
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: auditMock }));

vi.mock('@/lib/db', () => {
  const tx = {
    maintenanceRecord: { findFirst: findFirstMock, create: createMock },
    $executeRaw: executeRawMock,
    $queryRaw: queryRawMock,
  };
  return {
    db: {
      maintenancePlan: { findMany: findManyMock },
      // Проверка на дубль не должна уходить в базу вне транзакции.
      maintenanceRecord: { findFirst: dbFindFirstMock },
      $transaction: (cb: (t: typeof tx) => unknown) => {
        transactionMock();
        return cb(tx);
      },
    },
  };
});

vi.mock('@/modules/readiness/server', () => ({
  requestReadinessSnapshot: readinessMock,
}));

vi.mock('@/core/security/tenant-context', () => ({
  runWithTenantContext: (fn: () => unknown) => fn(),
  setRequestTenantId: vi.fn(),
}));

import { runPmScheduler } from '../pm-scheduler';

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

/** План, который заведомо просрочен: наработка достигла порога lastDone + interval. */
const overduePlan = {
  id: 'plan_1',
  tenantId: 'orion',
  equipmentId: 'eq_1',
  type: 'TO1',
  title: 'ТО-1',
  isActive: true,
  triggerType: 'HOURS',
  intervalHours: 100,
  lastDoneHours: 5600,
  leadTimeDays: 0,
  equipment: { id: 'eq_1', engineHoursTotal: 5700, meterReadings: [] },
};

describe('runPmScheduler', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findFirstMock.mockReset();
    createMock.mockReset();
    executeRawMock.mockReset();
    queryRawMock.mockReset();
    dbFindFirstMock.mockReset();
    readinessMock.mockReset();
    transactionMock.mockReset();
    auditMock.mockReset();
    findManyMock.mockResolvedValue([overduePlan]);
    executeRawMock.mockResolvedValue(1);
    createMock.mockResolvedValue({
      id: 'mr_1',
      updatedAt: new Date('2026-09-27T00:00:00.000Z'),
    });
    readinessMock.mockResolvedValue(undefined);
  });

  it('ошибка в транзакции наряда не создаёт события об успехе', async () => {
    findFirstMock.mockResolvedValue(null);
    readinessMock.mockRejectedValue(new Error('transaction failed'));
    await expect(runPmScheduler('orion', new Date('2026-09-27T00:00:00.000Z'))).rejects.toThrow('transaction failed');
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('не создаёт ТО и оповещение для активного регламента списанной машины (AU151)', async () => {
    const retiredPlan = {...overduePlan, equipment: {...overduePlan.equipment, isActive: false}};
    findManyMock.mockImplementation(async ({where}: {where: {equipment?: {isActive?: boolean}}}) =>
      where.equipment?.isActive === true ? [] : [retiredPlan]);
    findFirstMock.mockResolvedValue(null);

    const result = await runPmScheduler('orion', new Date('2026-09-27T00:00:00.000Z'));

    expect(result).toEqual({evaluated: 0, due: 0, created: 0, overdue: []});
    expect(createMock).not.toHaveBeenCalled();
    expect(readinessMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('берёт advisory-замок на «установка + тип» в организации до проверки дубля', async () => {
    findFirstMock.mockResolvedValue(null);
    await runPmScheduler('orion', new Date('2026-09-27T00:00:00.000Z'));

    // Замок — первый оператор внутри транзакции.
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const call = executeRawMock.mock.calls[0];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual(['pm:orion:eq_1:TO1']);
    // $queryRaw для замка не используется: колонка void ломает десериализацию.
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it('создаёт наряд только когда открытого наряда этого типа нет', async () => {
    findFirstMock.mockResolvedValue(null);
    const result = await runPmScheduler('orion', new Date('2026-09-27T00:00:00.000Z'));

    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
    const [{ data }] = createMock.mock.calls[0];
    expect(data).toMatchObject({ tenantId: 'orion', equipmentId: 'eq_1', type: 'TO1', status: 'PLANNED' });
    expect(result.created).toBe(1);
    expect(result.overdue).toHaveLength(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.scheduled', targetId: 'mr_1', tenantId: 'orion', actorId: null,
      metadata: expect.objectContaining({ auto: true, planId: 'plan_1', equipmentId: 'eq_1' }),
    }));
    expect(auditMock.mock.invocationCallOrder[0]).toBeGreaterThan(readinessMock.mock.invocationCallOrder[0]);
  });

  it('не создаёт второй наряд, если открытый уже есть', async () => {
    findFirstMock.mockResolvedValue({ id: 'mr_existing' });
    const result = await runPmScheduler('orion', new Date('2026-09-27T00:00:00.000Z'));

    expect(createMock).not.toHaveBeenCalled();
    expect(readinessMock).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('проверяет дубль внутри транзакции, а не чтением до неё', async () => {
    findFirstMock.mockResolvedValue(null);
    await runPmScheduler('orion', new Date('2026-09-27T00:00:00.000Z'));

    expect(transactionMock).toHaveBeenCalledTimes(1);
    // findFirst — это tx.maintenanceRecord.findFirst; база напрямую не читается.
    expect(findFirstMock).toHaveBeenCalledTimes(1);
    expect(dbFindFirstMock).not.toHaveBeenCalled();
  });
});
