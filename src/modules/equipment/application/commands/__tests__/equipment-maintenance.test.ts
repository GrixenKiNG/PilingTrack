import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUniqueEquipmentMock, createRecMock, findUniqueRecMock, updateRecMock,
  deleteRecMock, outboxCreateManyMock,
  findFirstEquipmentMock, updateEquipmentMock, findManyPlanMock, updatePlanMock,
  findFirstReadingMock, createReadingMock, executeRawMock, auditInTxMock,
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
  // Наработка, снятая при закрытии наряда, уходит в журнал показаний тем же
  // путём, что ручной ввод и осмотр. Кэш наработки двигает запрос базы
  // (GREATEST), а не прочитанное в JS значение — F-R38-4.
  findFirstReadingMock: vi.fn(),
  createReadingMock: vi.fn(),
  executeRawMock: vi.fn(),
  // Открытый наряд ТО — вход критерия готовности «Обслуживание»: команды
  // заказывают пересчёт снимка в той же транзакции, что и саму запись.
  outboxCreateManyMock: vi.fn(),
  // След приёмки пишется после коммита и приёмку не отменяет (решение владельца 24.10.2026).
  auditInTxMock: vi.fn(),
}));

vi.mock('@/modules/audit', () => ({ recordAuditEvent: auditInTxMock }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

vi.mock('@/lib/db', () => {
  const client = {
    equipment: {
      findUnique: findUniqueEquipmentMock,
      findFirst: findFirstEquipmentMock,
      update: updateEquipmentMock,
    },
    maintenancePlan: { findMany: findManyPlanMock, update: updatePlanMock },
    meterReading: { findFirst: findFirstReadingMock, create: createReadingMock },
    maintenanceRecord: {
      create: createRecMock,
      findUnique: findUniqueRecMock,
      update: updateRecMock,
      delete: deleteRecMock,
    },
    outboxEvent: { createMany: outboxCreateManyMock },
    $executeRaw: executeRawMock,
    $transaction: (cb: (t: unknown) => unknown) => cb(client),
  };
  return { db: client };
});

import { createMaintenance, updateMaintenance, acceptMaintenance, deleteMaintenance } from '../equipment-maintenance';
import { projectNextMaintenance } from '../maintenance-regulation';

// Безопасные значения по умолчанию: у техники без регламентов закрытие наряда
// не должно ничего двигать, и остальные наборы тестов об этом не знают.
beforeEach(() => {
  auditInTxMock.mockReset();
  auditInTxMock.mockResolvedValue(undefined);
  findFirstEquipmentMock.mockReset();
  updateEquipmentMock.mockReset();
  findManyPlanMock.mockReset();
  updatePlanMock.mockReset();
  findFirstEquipmentMock.mockResolvedValue({ id: 'eq_1', engineHoursTotal: null });
  findManyPlanMock.mockResolvedValue([]);
  updatePlanMock.mockResolvedValue({});
  updateEquipmentMock.mockResolvedValue({});
  findFirstReadingMock.mockReset();
  createReadingMock.mockReset();
  executeRawMock.mockReset();
  findFirstReadingMock.mockResolvedValue(null);
  createReadingMock.mockResolvedValue({ id: 'mr_1', engineHours: 0, recordedAt: new Date() });
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

  it.each(['DONE', 'CANCELLED'] as const)('rejects creating %s without its completion details', async (status) => {
    await expect(createMaintenance('eq_1', { type: 'REPAIR', title: 'x', status,
      workDone: ' ', cancelReason: ' ' }, { tenantId: 'orion' })).rejects.toMatchObject({ status: 422 });
    expect(createRecMock).not.toHaveBeenCalled();
    expect(outboxCreateManyMock).not.toHaveBeenCalled();
  });

  it('persists the trimmed reason when creating a cancelled order', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'x', status: 'CANCELLED',
      cancelReason: '  отменён заказчиком  ' }, { tenantId: 'orion' });
    expect(createRecMock.mock.calls[0][0].data.cancelReason).toBe('отменён заказчиком');
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
    ).rejects.toThrow('Установка не найдена');
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
    expect(findManyPlanMock).not.toHaveBeenCalled();
    expect(createReadingMock).not.toHaveBeenCalled();
  });

  it('creating DONE records service hours and advances the matching maintenance plan', async () => {
    const completedAt = new Date('2026-10-19T06:00:00Z');
    createRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', type: 'TO1',
      engineHoursAtService: 200, completedAt, updatedAt: completedAt });
    findFirstEquipmentMock.mockResolvedValue({ id: 'eq_1', engineHoursTotal: 100 });
    findManyPlanMock.mockResolvedValue([{ id: 'plan_1', type: 'TO1', triggerType: 'HOURS',
      intervalHours: 100, intervalDays: null, leadTimeDays: 7, lastDoneHours: 50, lastDoneAt: null }]);

    await createMaintenance('eq_1', { type: 'TO1', title: 'ТО-1', status: 'DONE',
      engineHoursAtService: 200, completedAt, workDone: 'Заменены фильтры' },
    { tenantId: 'orion', createdById: 'mechanic_1' });

    expect(updatePlanMock).toHaveBeenCalledWith({ where: { id: 'plan_1' },
      data: { lastDoneHours: 200, lastDoneAt: completedAt } });
    expect(updateEquipmentMock).toHaveBeenCalledWith({ where: { id: 'eq_1' },
      data: { nextMaintenanceAtHours: 300 } });
    expect(createReadingMock).toHaveBeenCalledTimes(1);
    expect(createReadingMock.mock.calls[0][0].data).toMatchObject({
      equipmentId: 'eq_1', engineHours: 200, recordedAt: completedAt,
      recordedById: 'mechanic_1', tenantId: 'orion',
    });
  });

  it('creating DONE propagates a failed meter write before requesting a snapshot', async () => {
    const completedAt = new Date('2026-10-19T06:00:00Z');
    createRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', type: 'TO1',
      engineHoursAtService: 200, completedAt, updatedAt: completedAt });
    createReadingMock.mockRejectedValue(new Error('meter write failed'));

    await expect(createMaintenance('eq_1', { type: 'TO1', title: 'ТО-1', status: 'DONE',
      engineHoursAtService: 200, workDone: 'Заменены фильтры' }, { tenantId: 'orion' }))
      .rejects.toThrow('meter write failed');
    expect(outboxCreateManyMock).not.toHaveBeenCalled();
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

  it.each([
    ['DONE', 'IN_PROGRESS'], ['DONE', 'CANCELLED'],
    ['CANCELLED', 'DONE'], ['CANCELLED', 'PLANNED'],
  ] as const)('rejects terminal transition %s → %s', async (status, nextStatus) => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', tenantId: 'orion',
      status, acceptedById: null, workDone: 'ремонт выполнен', cancelReason: 'отмена' });
    await expect(updateMaintenance('eq_1', 'rec_1', { status: nextStatus },
      { tenantId: 'orion', userId: 'usr_9' })).rejects.toMatchObject({ status: 409 });
    expect(updateRecMock).not.toHaveBeenCalled();
    expect(updatePlanMock).not.toHaveBeenCalled();
    expect(createReadingMock).not.toHaveBeenCalled();
    expect(outboxCreateManyMock).not.toHaveBeenCalled();
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
    ).rejects.toThrow('Запись ТО не найдена');
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
  it('keeps the mechanic who closed the order separately from the acceptor', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null,
      closedById: 'mechanic_1', completedAt: new Date('2026-10-12T10:00:00Z'), workDone: 'ремонт выполнен', status: 'DONE' });
    updateRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', updatedAt: new Date() });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });
    expect(updateRecMock.mock.calls.at(-1)?.[0].data).toMatchObject({ closedById: 'mechanic_1', acceptedById: 'admin_1' });
  });
  it('rejects accepting a cancelled order with otherwise complete work details', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', status: 'CANCELLED',
      acceptedById: null, workDone: 'ремонт выполнен' });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toMatchObject({ status: 409 });
    expect(updateRecMock).not.toHaveBeenCalled();
    expect(updatePlanMock).not.toHaveBeenCalled();
    expect(createReadingMock).not.toHaveBeenCalled();
    expect(outboxCreateManyMock).not.toHaveBeenCalled();
  });
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

  it('пишет след приёмки; сбой следа приёмку не отменяет — принятых нарядов без приёмки не бывает', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null, workDone: 'заменили РВД' });
    updateRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', title: 'ТО-1', updatedAt: new Date() });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });
    expect(auditInTxMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'maintenance.accepted', actorId: 'admin_1', targetId: 'rec_1', tenantId: 'orion',
      metadata: { name: 'ТО-1' },
    }));
    // След пишется после того, как приёмка записана.
    expect(auditInTxMock.mock.invocationCallOrder[0]).toBeGreaterThan(updateRecMock.mock.invocationCallOrder[0]);

    auditInTxMock.mockRejectedValue(new Error('лента недоступна'));
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null, workDone: 'заменили РВД' });
    const record = await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });
    expect(record).toMatchObject({ id: 'rec_1' });
  });

  it('чужая организация: след не пишется', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', acceptedById: null, completedAt: null });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' })).rejects.toThrow();
    expect(auditInTxMock).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant record; writes nothing', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', acceptedById: null, completedAt: null });
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toThrow('Запись ТО не найдена');
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

  it('приёмка, опоздавшая к чужой, отвечает 409, а не 500', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', acceptedById: null, completedAt: null, workDone: 'x', status: 'DONE' });
    updateRecMock.mockRejectedValue(Object.assign(new Error('Record not found'), { code: 'P2025' }));
    await expect(acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' }))
      .rejects.toMatchObject({ status: 409 });
    // Условие записи повторяет проверку: второй проход не найдёт строку.
    expect(updateRecMock.mock.calls[0][0].where).toMatchObject({ acceptedById: null, status: 'DONE' });
  });
});

describe('deleteMaintenance — удаление', () => {
  // Строка, которую возвращает `delete` (DELETE … RETURNING) — снимок для ленты
  // и единственный достоверный источник «был ли наряд открыт» (F-R72-FEED-b).
  const REMOVED = {
    id: 'rec_1', title: 'Замена РВД', type: 'REPAIR', status: 'IN_PROGRESS', scheduledAt: null,
  };

  beforeEach(() => {
    findUniqueRecMock.mockReset();
    deleteRecMock.mockReset();
    deleteRecMock.mockResolvedValue(REMOVED);
    outboxCreateManyMock.mockReset();
    outboxCreateManyMock.mockResolvedValue({ count: 1 });
  });

  it('не даёт удалить принятый наряд — приёмку не стереть', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', tenantId: 'orion', status: 'DONE', acceptedById: 'admin_1' });
    await expect(deleteMaintenance('eq_1', 'rec_1', { tenantId: 'orion' }))
      .rejects.toMatchObject({ status: 409 });
    expect(deleteRecMock).not.toHaveBeenCalled();
  });

  it('возвращает удалённую строку с полями снимка', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', tenantId: 'orion', status: 'IN_PROGRESS', acceptedById: null });
    const removed = await deleteMaintenance('eq_1', 'rec_1', { tenantId: 'orion' });

    expect(removed).toEqual(REMOVED);
    expect(deleteRecMock.mock.calls[0][0].select).toEqual({
      id: true, title: true, type: true, status: true, scheduledAt: true,
    });
  });

  // Статус между чтением и удалением могли поменять: снимок готовности решает
  // ВОЗВРАЩЁННАЯ строка, а не предварительное чтение.
  it('заказывает снимок, если удалённая строка открыта, хотя чтение дало CLOSED', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', tenantId: 'orion', status: 'DONE', acceptedById: null });

    await deleteMaintenance('eq_1', 'rec_1', { tenantId: 'orion' });

    expect(outboxCreateManyMock).toHaveBeenCalledTimes(1);
  });

  it('не заказывает снимок, если удалённая строка закрыта, хотя чтение дало OPEN', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', tenantId: 'orion', status: 'PLANNED', acceptedById: null });
    deleteRecMock.mockResolvedValue({ ...REMOVED, status: 'DONE' });

    await deleteMaintenance('eq_1', 'rec_1', { tenantId: 'orion' });

    expect(outboxCreateManyMock).not.toHaveBeenCalled();
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

  // Наработка при закрытии — настоящее показание счётчика. Раньше оно оставалось
  // внутри наряда, и журнал наработки о нём не знал.
  it('заводит показание в журнал датой закрытия, а не «сейчас»', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' });

    expect(createReadingMock).toHaveBeenCalledTimes(1);
    expect(createReadingMock.mock.calls[0][0].data).toMatchObject({
      equipmentId: 'eq_1',
      engineHours: 1250,
      recordedAt: doneRecord.completedAt,
      recordedById: 'usr_9',
      tenantId: 'orion',
    });
  });

  it('наряд без наработки показания не заводит', async () => {
    updateRecMock.mockResolvedValue({ ...doneRecord, engineHoursAtService: null });
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' });

    expect(createReadingMock).not.toHaveBeenCalled();
  });

  it('приёмка уже закрытого наряда не заводит второе показание', async () => {
    findUniqueRecMock.mockResolvedValue({
      id: 'rec_1', tenantId: 'orion', acceptedById: null,
      completedAt: doneRecord.completedAt, workDone: 'ТО-1 по регламенту', status: 'DONE',
    });
    await acceptMaintenance('rec_1', { tenantId: 'orion', userId: 'admin_1' });

    expect(createReadingMock).not.toHaveBeenCalled();
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
