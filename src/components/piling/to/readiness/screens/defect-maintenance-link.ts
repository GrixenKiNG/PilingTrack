import type {MaintenanceSummary} from '../../readiness-design-views';
import type {DefectDto} from '../api/contracts';

/** Наряды, под которые ещё можно взять дефект в работу. */
const OPEN_ORDER_STATUSES = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'];

export function linkableOrders(maintenance: readonly MaintenanceSummary[], equipmentId: string): MaintenanceSummary[] {
  return maintenance.filter((order) => order.equipment?.id === equipmentId && OPEN_ORDER_STATUSES.includes(order.status));
}

/**
 * Наряд, связанный с дефектом, и можно ли по нему закрыть дефект.
 *
 * «Ремонт завершён» не снимает препятствие само: дефект закрывает человек.
 * Кнопка «Закрыть после ТО» — подсказка, что наряд уже принят и пора это сделать.
 * Принят — значит `acceptedAt` задан: наряд, закрытый осмотром, приёмки не
 * проходит и кнопки не даёт.
 *
 * `order: null` при заданной связи — наряд не загружен (нет права читать ТО) или
 * принадлежит другой установке; закрыть по нему нельзя, ссылку показать можно.
 */
export function linkedOrderOf(
  defect: DefectDto,
  maintenance: readonly MaintenanceSummary[],
): {order: MaintenanceSummary | null; readyToClose: boolean} | null {
  if (!defect.maintenanceRecordId) return null;
  const order = maintenance.find((item) => item.id === defect.maintenanceRecordId && item.equipment?.id === defect.equipmentId) ?? null;
  const readyToClose = order !== null
    && order.status === 'DONE'
    && Boolean(order.acceptedAt)
    && defect.status === 'IN_WORK';
  return {order, readyToClose};
}

export function closeAfterMaintenancePrefill(order: MaintenanceSummary): string {
  const done = order.workDone?.trim();
  return `Устранено по наряду ТО «${order.title}»${done ? `: ${done}` : ''}`;
}
