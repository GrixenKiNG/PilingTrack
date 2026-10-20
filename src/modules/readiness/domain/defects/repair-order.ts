import type {DefectSeverity} from './types';

/**
 * Уровни, при которых дефект сам заводит заявку на ТО (решение владельца
 * 18.10.2026). Низкий и обычный остаются ручными: их разбирает диспетчер.
 */
export const AUTO_REPAIR_ORDER_SEVERITIES: readonly DefectSeverity[] = ['HIGH', 'CRITICAL'];

export const opensRepairOrder = (severity: DefectSeverity): boolean =>
  AUTO_REPAIR_ORDER_SEVERITIES.includes(severity);
