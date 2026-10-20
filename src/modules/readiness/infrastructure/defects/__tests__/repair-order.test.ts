import {describe, expect, it, vi} from 'vitest';
import {createRepairOrderForDefect} from '../repair-order';

/** Правило уровня проверяется здесь один раз: все три пути создания дефекта идут через эту функцию. */
const input = {tenantId: 'tenant-1', equipmentId: 'equipment-1', defectTitle: 'Течь', actorId: 'operator-1'};

const makeTx = () => ({maintenanceRecord: {create: vi.fn(async () => ({id: 'rec-1'}))}});

describe('createRepairOrderForDefect', () => {
  it.each(['HIGH', 'CRITICAL'] as const)('уровень %s: заводит REPAIR/PLANNED и возвращает его id', async (severity) => {
    const tx = makeTx();

    const id = await createRepairOrderForDefect(tx as never, {...input, severity});

    expect(id).toBe('rec-1');
    expect(tx.maintenanceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1', equipmentId: 'equipment-1', type: 'REPAIR', status: 'PLANNED',
        priority: 'HIGH', createdById: 'operator-1', title: 'Устранение дефекта: Течь',
      }),
      select: {id: true},
    });
  });

  it.each(['LOW', 'NORMAL'] as const)('уровень %s: заявку не заводит', async (severity) => {
    const tx = makeTx();

    const id = await createRepairOrderForDefect(tx as never, {...input, severity});

    expect(id).toBeNull();
    expect(tx.maintenanceRecord.create).not.toHaveBeenCalled();
  });
});
