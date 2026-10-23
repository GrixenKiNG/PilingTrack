/**
 * Наряды ТО и установка — конкурентные записи (находки Codex XP41, 21.10.2026).
 *
 * Состояние читается до транзакции, поэтому условие записи должно повторять
 * то, на чём основано решение: статус при переходе, описание работ при
 * приёмке, давность факта регламента, атомарность правки карточки и показания
 * счётчика. База смоделирована в памяти и честно проверяет условия where.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    maintenanceRecord: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    maintenancePlan: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    equipment: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  snapshot: vi.fn(),
  addReading: vi.fn(),
  readingInTx: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));
vi.mock('@/modules/audit', () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/modules/readiness/server', () => ({
  OPEN_MAINTENANCE: ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'],
  requestReadinessSnapshot: mocks.snapshot,
}));
vi.mock('../meter-reading', () => ({
  addMeterReading: mocks.addReading,
  recordMeterReadingInTx: mocks.readingInTx,
}));

// Формула сроков не является предметом этих тестов.
// Мок позволяет загрузить настоящий advanceMaintenanceRegulation.
vi.mock('@/lib/pm-due', () => ({
  evaluatePlanDue: (plan: { lastDoneHours: number | null }) => ({
    targetHours: (plan.lastDoneHours ?? 0) + 50,
    dueDate: null,
  }),
}));

import { acceptMaintenance, updateMaintenance } from '../equipment-maintenance';
import { updateEquipmentMetadata } from '../equipment-metadata';

function record(id: string) {
  return {
    id,
    tenantId: 't1',
    equipmentId: 'e1',
    type: 'TO1',
    status: 'PLANNED',
    acceptedById: null as string | null,
    acceptedAt: null as Date | null,
    closedById: null as string | null,
    completedAt: null as Date | null,
    startedAt: null as Date | null,
    engineHoursAtService: null as number | null,
    workDone: 'Заменён фильтр',
    cancelReason: null as string | null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
  };
}

function plan() {
  return {
    id: 'p1',
    tenantId: 't1',
    equipmentId: 'e1',
    type: 'TO1',
    isActive: true,
    triggerType: 'HOURS',
    intervalHours: 50,
    intervalDays: null,
    leadTimeDays: 0,
    lastDoneHours: null as number | null,
    lastDoneAt: null as Date | null,
  };
}

function initialState() {
  return {
    records: {} as Record<string, ReturnType<typeof record>>,
    plans: [] as ReturnType<typeof plan>[],
    equipment: {
      id: 'e1',
      tenantId: 't1',
      inventoryNumber: 'OLD',
      engineHoursTotal: 200,
    },
  };
}

type Mutation = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

function matches(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    return actual instanceof Date && expected instanceof Date
      ? actual.getTime() === expected.getTime()
      : actual === expected;
  });
}

function missing(): never {
  throw Object.assign(new Error('Record not found'), { code: 'P2025' });
}

let state = initialState();
let beforeTransaction: (() => Promise<void>) | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  state = initialState();
  beforeTransaction = undefined;

  mocks.snapshot.mockResolvedValue(undefined);
  mocks.addReading.mockResolvedValue(undefined);
  mocks.readingInTx.mockResolvedValue(undefined);

  mocks.db.$transaction.mockImplementation(
    async (run: (tx: typeof mocks.db) => Promise<unknown>) => {
      // B коммитится до начала транзакции A.
      const interleave = beforeTransaction;
      beforeTransaction = undefined;
      if (interleave) await interleave();

      const committed = structuredClone(state);
      try {
        return await run(mocks.db);
      } catch (error) {
        state = committed;
        throw error;
      }
    },
  );

  mocks.db.maintenanceRecord.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) =>
      structuredClone(state.records[where.id] ?? null),
  );

  mocks.db.maintenanceRecord.update.mockImplementation(
    async ({ where, data }: Mutation) => {
      const row = Object.values(state.records).find((r) => matches(r, where));
      if (!row) missing();
      Object.assign(row, data);
      return structuredClone(row);
    },
  );

  mocks.db.maintenancePlan.findMany.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) =>
      structuredClone(state.plans.filter((p) => matches(p, where))),
  );

  mocks.db.maintenancePlan.update.mockImplementation(
    async ({ where, data }: Mutation) => {
      const row = state.plans.find((p) => matches(p, where));
      if (!row) missing();
      Object.assign(row, data);
      return structuredClone(row);
    },
  );

  mocks.db.maintenancePlan.updateMany.mockImplementation(
    async ({ where, data }: Mutation) => {
      const rows = state.plans.filter((p) => matches(p, where));
      for (const row of rows) Object.assign(row, data);
      return { count: rows.length };
    },
  );

  mocks.db.equipment.findFirst.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) =>
      matches(state.equipment, where)
        ? structuredClone(state.equipment)
        : null,
  );

  mocks.db.equipment.update.mockImplementation(
    async ({ where, data }: Mutation) => {
      if (!matches(state.equipment, where)) missing();
      Object.assign(state.equipment, data);
      return structuredClone(state.equipment);
    },
  );
});

describe('XP41', () => {
  it('XP41-1: stale PLANNED save cannot reopen DONE', async () => {
    state.records.r1 = record('r1');

    beforeTransaction = async () => {
      await updateMaintenance(
        'e1',
        'r1',
        { status: 'DONE', workDone: 'Заменён фильтр' },
        { tenantId: 't1', userId: 'mechanic-b' },
      );
    };

    await expect(
      updateMaintenance(
        'e1',
        'r1',
        { status: 'PLANNED', title: 'Правка формы A' },
        { tenantId: 't1', userId: 'mechanic-a' },
      ),
    ).rejects.toThrow('Наряд уже изменён или принят');

    expect(state.records.r1.status).toBe('DONE');
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it('XP41-1b: acceptance rejects concurrently cleared workDone', async () => {
    state.records.r1 = record('r1');

    beforeTransaction = async () => {
      await updateMaintenance(
        'e1',
        'r1',
        { workDone: '' },
        { tenantId: 't1', userId: 'mechanic-b' },
      );
    };

    await expect(
      acceptMaintenance('r1', { tenantId: 't1', userId: 'admin-a' }),
    ).rejects.toThrow('Наряд уже изменён или принят');

    expect(state.records.r1.workDone).toBe('');
    expect(state.records.r1.acceptedById).toBeNull();
    expect(state.records.r1.status).toBe('PLANNED');
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it('XP41-2: accepting older DONE preserves newer regulation fact', async () => {
    const oldDate = new Date('2026-10-01T10:00:00Z');
    const newDate = new Date('2026-10-02T10:00:00Z');

    state.plans = [plan()];
    state.records.a = {
      ...record('a'),
      status: 'DONE',
      completedAt: oldDate,
      engineHoursAtService: 100,
    };
    state.records.b = record('b');

    // Сначала закрываем новый наряд через настоящую команду.
    await updateMaintenance(
      'e1',
      'b',
      {
        status: 'DONE',
        completedAt: newDate,
        engineHoursAtService: 200,
        workDone: 'Новое обслуживание',
      },
      { tenantId: 't1', userId: 'mechanic' },
    );

    expect(state.plans[0].lastDoneAt).toEqual(newDate);
    expect(state.plans[0].lastDoneHours).toBe(200);

    // Затем принимаем старый уже закрытый наряд.
    await acceptMaintenance('a', { tenantId: 't1', userId: 'admin' });

    expect(state.records.a.acceptedById).toBe('admin');
    expect(state.plans[0].lastDoneAt).toEqual(newDate);
    expect(state.plans[0].lastDoneHours).toBe(200);
  });

  it('XP41-3: meter failure rolls back inventoryNumber', async () => {
    const failure = new Error('meter write failed');
    // Текущая и исправленная ветки получают одинаковую ошибку.
    mocks.addReading.mockRejectedValue(failure);
    mocks.readingInTx.mockRejectedValue(failure);

    await expect(
      updateEquipmentMetadata(
        'e1',
        { inventoryNumber: 'NEW', engineHoursTotal: 201 },
        { tenantId: 't1', actorId: 'admin' },
      ),
    ).rejects.toThrow('meter write failed');

    expect(state.equipment.inventoryNumber).toBe('OLD');
    expect(state.equipment.engineHoursTotal).toBe(200);
  });
});
