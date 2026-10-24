import {describe, expect, it, vi} from 'vitest';
import {recordDefectInTx} from '../record-defect';

/** Клиент транзакции: только то, до чего доходит запись дефекта. */
function fakeTx() {
  return {
    maintenanceRecord: {create: vi.fn().mockResolvedValue({id: 'order-1'})},
    equipmentDefect: {create: vi.fn().mockResolvedValue({id: 'defect-1'})},
    outboxEvent: {createMany: vi.fn().mockResolvedValue({count: 1})},
  };
}

const base = {
  tenantId: 'orion', equipmentId: 'eq-1', title: 'Течь РВД', description: 'капает',
  reportedById: 'u1', reportedAt: new Date('2026-10-24T01:00:00.000Z'),
};

// Правило владельца (18.10.2026): дефект высокого и критического уровня сам заводит заявку на ТО.
// Оно одно на все места, где рождается дефект (осмотр механика, чек-лист машиниста).
describe('recordDefectInTx — дефект и заявка ТО одной записью', () => {
  it.each(['HIGH', 'CRITICAL'] as const)('уровень %s заводит заявку и привязывает её к дефекту', async (severity) => {
    const tx = fakeTx();
    const result = await recordDefectInTx(tx as never, {...base, severity});

    expect(tx.maintenanceRecord.create).toHaveBeenCalledOnce();
    expect(tx.equipmentDefect.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'orion', equipmentId: 'eq-1', severity, title: 'Течь РВД', reportedById: 'u1',
      maintenanceRecordId: 'order-1',
    });
    expect(result).toEqual({id: 'defect-1', maintenanceRecordId: 'order-1'});
  });

  it.each(['LOW', 'NORMAL'] as const)('уровень %s заявку не заводит: дефект остаётся ручным', async (severity) => {
    const tx = fakeTx();
    const result = await recordDefectInTx(tx as never, {...base, severity});

    expect(tx.maintenanceRecord.create).not.toHaveBeenCalled();
    expect(tx.equipmentDefect.create.mock.calls[0][0].data.maintenanceRecordId).toBeNull();
    expect(result.maintenanceRecordId).toBeNull();
  });

  it('переносит узел, осмотр, смену, ключ источника и снимки как есть', async () => {
    const tx = fakeTx();
    await recordDefectInTx(tx as never, {
      ...base, severity: 'NORMAL', node: 'Гидравлика', inspectionId: 'ins-1', shiftId: 'shift-1',
      sourceKey: 'eq-1:PRESHIFT:hoses', evidenceMediaIds: ['m1'],
    });
    expect(tx.equipmentDefect.create.mock.calls[0][0].data).toMatchObject({
      node: 'Гидравлика', inspectionId: 'ins-1', shiftId: 'shift-1', sourceKey: 'eq-1:PRESHIFT:hoses',
      evidenceMediaIds: ['m1'], reportedAt: base.reportedAt,
    });
  });

  it('по умолчанию пересчёт готовности не заказывает (операторская команда заказывает один на весь осмотр)', async () => {
    const tx = fakeTx();
    await recordDefectInTx(tx as never, {...base, severity: 'HIGH'});
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('с requestSnapshot заказывает пересчёт по дефекту в той же транзакции', async () => {
    const tx = fakeTx();
    await recordDefectInTx(tx as never, {...base, severity: 'HIGH', requestSnapshot: true});
    const [{data}] = tx.outboxEvent.createMany.mock.calls[0];
    expect(data[0]).toMatchObject({
      type: 'ReadinessSnapshotRequested', tenantId: 'orion', aggregateId: 'defect-1', aggregateType: 'EquipmentDefect',
      dedupeKey: 'readiness.snapshot:orion:eq-1:DEFECT_CHANGED:defect-1:created',
    });
    expect(data[0].payload).toMatchObject({triggerType: 'DEFECT_CHANGED', triggerId: 'defect-1:created', equipmentId: 'eq-1'});
  });

  it('без организации — отказ, ничего не пишется', async () => {
    const tx = fakeTx();
    await expect(recordDefectInTx(tx as never, {...base, tenantId: '', severity: 'HIGH'})).rejects.toMatchObject({status: 400});
    expect(tx.equipmentDefect.create).not.toHaveBeenCalled();
    expect(tx.maintenanceRecord.create).not.toHaveBeenCalled();
  });
});
