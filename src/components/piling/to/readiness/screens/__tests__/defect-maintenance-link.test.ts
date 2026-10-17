import {describe, expect, it} from 'vitest';
import type {MaintenanceSummary} from '../../../readiness-design-views';
import type {DefectDto} from '../../api/contracts';
import {closeAfterMaintenancePrefill, linkableOrders, linkedOrderOf} from '../defect-maintenance-link';

const order = (over: Partial<MaintenanceSummary> & {equipmentId?: string} = {}) => {
  const {equipmentId = 'eq-1', ...rest} = over;
  return {
    id: 'rec-1', type: 'REPAIR', status: 'IN_PROGRESS', priority: 'HIGH', title: 'Замена уплотнения',
    scheduledAt: null, completedAt: null, createdAt: '2099-03-01T08:00:00Z', acceptedAt: null,
    workDone: null, equipment: {id: equipmentId, name: 'Копёр', model: null}, ...rest,
  } as MaintenanceSummary;
};
const defect = (over: Partial<DefectDto> = {}) =>
  ({id: 'd-1', equipmentId: 'eq-1', status: 'IN_WORK', maintenanceRecordId: 'rec-1', ...over} as DefectDto);

describe('linkableOrders', () => {
  it('предлагает только открытые наряды этой установки', () => {
    const list = [
      order({id: 'a', status: 'PLANNED'}),
      order({id: 'b', status: 'ON_HOLD'}),
      order({id: 'c', status: 'DONE'}),
      order({id: 'd', status: 'CANCELLED'}),
      order({id: 'e', status: 'IN_PROGRESS', equipmentId: 'eq-2'}),
    ];
    expect(linkableOrders(list, 'eq-1').map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('linkedOrderOf', () => {
  it('не находит наряд у дефекта без связи', () => {
    expect(linkedOrderOf(defect({maintenanceRecordId: null}), [order()])).toBeNull();
  });

  it('связь есть, наряда нет в загруженном списке: закрывать после ТО нельзя', () => {
    expect(linkedOrderOf(defect(), [])).toEqual({order: null, readyToClose: false});
  });

  it('наряд в работе: дефект рано закрывать', () => {
    expect(linkedOrderOf(defect(), [order({status: 'IN_PROGRESS'})])?.readyToClose).toBe(false);
  });

  it('наряд выполнен, но не принят: дефект рано закрывать', () => {
    expect(linkedOrderOf(defect(), [order({status: 'DONE', acceptedAt: null})])?.readyToClose).toBe(false);
  });

  it('наряд принят, дефект в работе: можно закрыть после ТО', () => {
    const result = linkedOrderOf(defect(), [order({status: 'DONE', acceptedAt: '2099-03-02T08:00:00Z'})]);
    expect(result?.readyToClose).toBe(true);
  });

  it('наряд принят, но дефект уже закрыт или не разобран: кнопки нет', () => {
    const accepted = [order({status: 'DONE', acceptedAt: '2099-03-02T08:00:00Z'})];
    expect(linkedOrderOf(defect({status: 'CLOSED'}), accepted)?.readyToClose).toBe(false);
    expect(linkedOrderOf(defect({status: 'OPEN'}), accepted)?.readyToClose).toBe(false);
  });

  it('наряд другой установки не считается связанным', () => {
    const foreign = [order({status: 'DONE', acceptedAt: '2099-03-02T08:00:00Z', equipmentId: 'eq-2'})];
    expect(linkedOrderOf(defect(), foreign)).toEqual({order: null, readyToClose: false});
  });
});

describe('closeAfterMaintenancePrefill', () => {
  it('подставляет название наряда и описание работ', () => {
    expect(closeAfterMaintenancePrefill(order({workDone: 'Заменили манжету'})))
      .toBe('Устранено по наряду ТО «Замена уплотнения»: Заменили манжету');
  });

  it('без описания работ — только название наряда', () => {
    expect(closeAfterMaintenancePrefill(order({workDone: ' '})))
      .toBe('Устранено по наряду ТО «Замена уплотнения»');
  });
});
