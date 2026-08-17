import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUniqueEquipmentMock, createRecMock, findUniqueRecMock, updateRecMock,
  deleteRecMock, outboxCreateManyMock,
  findFirstEquipmentMock, updateEquipmentMock, findManyPlanMock, updatePlanMock,
} = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  createRecMock: vi.fn(),
  findUniqueRecMock: vi.fn(),
  updateRecMock: vi.fn(),
  deleteRecMock: vi.fn(),
  // Закрытие наряда сдвигает регламент ТО: отметка выполнения в плане и
  // проекция ближайшего срока в карточку техники.
  findFirstEquipmentMock: vi.fn(),
  updateEquipmentMock: vi.fn(),
  findManyPlanMock: vi.fn(),
  updatePlanMock: vi.fn(),
  // Открытый наряд ТО — вход критерия готовности «Обслуживание»: команды
  // заказывают пересчёт снимка в той же транзакции, что и саму запись.
  outboxCreateManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const client = {
    equipment: {
      findUnique: findUniqueEquipmentMock,
      findFirst: findFirstEquipmentMock,
      update: updateEquipmentMock,
    },
    maintenancePlan: { findMany: findManyPlanMock, update: updatePlanMock },
    maintenanceRecord: {
      create: createRecMock,
      findUnique: findUniqueRecMock,
      update: updateRecMock,
      delete: deleteRecMock,
    },
    outboxEvent: { createMany: outboxCreateManyMock },
    $transaction: (cb: (t: unknown) => unknown) => cb(client),
  };
  return { db: client };
});

import { createMaintenance, updateMaintenance, acceptMaintenance } from '../equipment-maintenance';
import { projectNextMaintenance } from '../maintenance-regulation';

// Безопасные значения по умолчанию: у техники без регламентов закрытие наряда
// не должно ничего двигать, и остальные наборы тестов об этом не знают.
beforeEach(() => {
  findFirstEquipmentMock.mockReset();
  updateEquipmentMock.mockReset();
  findManyPlanMock.mockReset();
  updatePlanMock.mockReset();
  findFirstEquipmentMock.mockResolvedValue({ id: 'eq_1', engineHoursTotal: null });
  findManyPlanMock.mockResolvedValue([]);
  updatePlanMock.mockResolvedValue({});
  updateEquipmentMock.mockResolvedValue({});
});

describe('createMaintenance — work order fields', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    createRecMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    outboxCreateManyMock.mockReset();
    outboxCreateManyMock.mockResolvedValue({ count: 1 });
    // equipmentId и updatedAt нужны заказу пересчёта готовности.
    createRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', updatedAt: new Date('2026-08-12T00:00:00Z') });
  });

  it('checks equipment existence scoped by tenantId', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'Ремонт насоса' }, { tenantId: 'orion' });
    expect(findUniqueEquipmentMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });
  });

  it('persists new work order fields and defaults priority to NORMAL', async () => {
    await createMaintenance(
      'eq_1',
      { type: 'REPAIR', title: 'x', priority: 'HIGH', assigneeId: 'usr_2', faultCause: 'кавитация', partsUsedText: 'фильтр' },
      { tenantId: 'orion' },
    );
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.priority).toBe('HIGH');
    expect(data.assigneeId).toBe('usr_2');
    expect(data.faultCause).toBe('кавитация');
    expect(data.partsUsedText).toBe('фильтр');
  });

  it('throws 404 when equipment missing', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);
    await expect(
      createMaintenance('missing', { type: 'FAULT', title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Equipment not found');
  });

  it('coerces null partsUsedText to empty string', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', partsUsedText: null }, { tenantId: 'orion' });
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.partsUsedText).toBe('');
  });

  it('persists two-stage workDone, empty by default', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', workDone: 'заменили насос' }, { tenantId: 'orion' });
    expect(createRecMock.mock.calls[0][0].data.workDone).toBe('заменили насос');
    createRecMock.mockClear();
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x' }, { tenantId: 'orion' });
    expect(createRecMock.mock.calls[0][0].data.workDone).toBe('');
  });

  it('auto-stamps startedAt when created directly as IN_PROGRESS', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', status: 'IN_PROGRESS' }, { tenantId: 'orion' });
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
  });
});

describe('updateMaintenance — lifecycle transitions', () => {
  beforeEach(() => {
    findUniqueRecMock.mockReset();
    updateRecMock.mockReset();
    updateRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', updatedAt: new Date('2026-08-12T00:00:00Z') });
    outboxCreateManyMock.mockReset();
    outboxCreateManyMock.mockResolvedValue({ count: 1 });
    // workDone заполнен: закрытие пустого наряда запрещено отдельным правилом,
    // и наборы про startedAt/closedById не про него.
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'orion', status: 'PLANNED', workDone: 'заменили фильтр' });
  });

  it('sets startedAt when status moves to IN_PROGRESS', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'IN_PROGRESS' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
  });

  it('sets closedById from ctx when status moves to DONE', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.closedById).toBe('usr_9');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('rejects cross-tenant record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'other', status: 'PLANNED' });
    await expect(
      updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow('Maintenance record not found');
  });

  it('does not overwrite startedAt when already started', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: new Date('2026-01-01T00:00:00Z'), tenantId: 'orion', status: 'PLANNED' });
    await updateMaintenance('eq_1', 'rec_1', { status: 'IN_PROGRESS' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeUndefined();
  });

  it('persists two-stage workDone on update', async () => {
    await updateMaintenance('eq_1', 'rec_1', { workDone: 'продули радиатор' }, { tenantId: 'orion', userId: 'usr_9' });
    expect(updateRecMock.mock.calls[0][0].data.workDone).toBe('продули радиатор');
  });

  // Наряд, закрытый без описания работ, — это «выполнено» без единого
  // доказательства; на 2026-08-16 такими были все 19 закрытых записей в базе.
  it('не даёт закрыть наряд с пустыми «выполненными работами»', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'orion', status: 'IN_PROGRESS', workDone: '   ' });
    await expect(
      updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow(/выполненные работы/i);
    expect(updateRecMock).not.toHaveBeenCalled();
  });

  it('закрывает наряд, если работы описаны в том же запросе', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'orion', status: 'IN_PROGRESS', workDone: '' });
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE', workDone: 'заменили РВД' }, { tenantId: 'orion', userId: 'usr_9' });
    expect(updateRecMock.mock.calls[0][0].data.status).toBe('DONE');
  });

  // Отмена — то же завершение наряда: без причины он неотличим от потерянного.
  it('не даёт отменить наряд без причины', async () => {
    await expect(
      updateMaintenance('eq_1', 'rec_1', { status: 'CANCELLED' }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow(/без причины/i);
    expect(updateRecMock).not.toHaveBeenCalled();
  });

  it('отменяет наряд с причиной и запоминает, кто снял', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'CANCELLED', cancelReason: 'узел заменён целиком' },
      { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.status).toBe('CANCELLED');
    expect(data.cancelReason).toBe('узел заменён целиком');
    expect(data.closedById).toBe('usr_9');
  });

  it('rejects edits to an already-accepted record', async () => {
    findUniqueRecMock.mockResolvedValue({
      id: 'rec_1', equipmentId: 'eq_1', completedAt: new Date(), startedAt: new Date(), tenantId: 'orion',
      acceptedById: 'usr_admin',
    });
    await expect(
      updateMaintenance('eq_1', 'rec_1', { cost: 999 }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow('Запись уже принята');
    expect(updateRecMock).not.toHaveBeenCalled();
  });
});

describe('acceptMaintenance — приёмка', () => {
  beforeEach(() => {
    findUniqueRecMock.mockReset();
    updateRecMock.mockReset();
    updateRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', updatedAt: new Date('2026-08-12T00:00:00Z') });
    outboxCreateManyMock.mockReset();
    outboxCreateManyMock.mockResolvedValue({ count: 1 });
  });

  it('stamps acceptedBy/acceptedAt and closes the record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null, workDone: 'заменили РВД' });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.acceptedById).toBe('admin_1');
    expect(data.acceptedAt).toBeInstanceOf(Date);
    expect(data.status).toBe('DONE');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('rejects cross-tenant record; writes nothing', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', acceptedById: null, completedAt: null });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toThrow('Maintenance record not found');
    expect(updateRecMock).not.toHaveBeenCalled();
  });

  it('rejects double-accept (409); writes nothing', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: 'admin_0', completedAt: new Date(), workDone: 'x' });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toThrow(/принят/i);
    expect(updateRecMock).not.toHaveBeenCalled();
  });

  // Приёмка ставит DONE напрямую — без своей проверки она была обходным путём
  // для того же пустого закрытия.
  it('не принимает наряд без описания выполненных работ', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null, workDone: '' });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toThrow(/выполненные работы/i);
    expect(updateRecMock).not.toHaveBeenCalled();
  });
});

// Причина существования этих тестов: закрытие наряда ТО не двигало регламент,
// поэтому критерий «Обслуживание» в техготовности горел вечно — моточасы росли,
// а порог следующего ТО стоял на месте и правился только руками в карточке.
describe('регламент ТО сдвигается при закрытии наряда', () => {
  const doneRecord = {
    id: 'rec_1', equipmentId: 'eq_1', tenantId: 'orion', type: 'TO1',
    engineHoursAtService: 1250, completedAt: new Date('2026-08-14T06:00:00Z'),
    updatedAt: new Date('2026-08-14T06:00:00Z'),
  };
  const hoursPlan = {
    id: 'plan_1', type: 'TO1', triggerType: 'HOURS', intervalHours: 250, intervalDays: null,
    leadTimeDays: 7, lastDoneHours: 1000, lastDoneAt: null, isActive: true,
  };

  beforeEach(() => {
    findUniqueRecMock.mockResolvedValue({
      id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: new Date('2026-08-14T02:00:00Z'),
      tenantId: 'orion', status: 'IN_PROGRESS', acceptedById: null, workDone: 'ТО-1 по регламенту',
    });
    updateRecMock.mockResolvedValue(doneRecord);
    findFirstEquipmentMock.mockResolvedValue({ id: 'eq_1', engineHoursTotal: 1250 });
    findManyPlanMock.mockResolvedValue([hoursPlan]);
  });

  it('отмечает выполнение в регламенте и двигает порог на технике', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' });

    expect(updatePlanMock.mock.calls[0][0].data.lastDoneHours).toBe(1250);
    expect(updateEquipmentMock.mock.calls[0][0].data.nextMaintenanceAtHours).toBe(1500);
  });

  it('повторный проход (приёмка после закрытия) не сдвигает порог второй раз', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null, workDone: 'ТО-1 по регламенту' });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });

    const thresholds = updateEquipmentMock.mock.calls.map((call) => call[0].data.nextMaintenanceAtHours);
    expect(thresholds).toEqual([1500, 1500]);
  });

  it('берёт ближайший срок среди регламентов, а не последний', () => {
    const next = projectNextMaintenance(
      [
        // Порог 1500 — дальний; порог 1350 — ближний. Порядок в списке обратный
        // ожидаемому ответу нарочно: «последний выигравший» тут не сработает.
        { triggerType: 'HOURS', intervalHours: 250, leadTimeDays: 7, lastDoneHours: 1250 },
        { triggerType: 'HOURS', intervalHours: 100, leadTimeDays: 7, lastDoneHours: 1250 },
        { triggerType: 'CALENDAR', intervalDays: 30, leadTimeDays: 7, lastDoneAt: new Date('2026-08-01T00:00:00Z') },
      ],
      1250,
      new Date('2026-08-14T00:00:00Z'),
    );
    expect(next.nextMaintenanceAtHours).toBe(1350);
    expect(next.nextMaintenanceDate?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});
