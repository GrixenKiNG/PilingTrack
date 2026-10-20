export * from './domain/readiness-rules';
export * from './domain/readiness-score';
export { isPermitInForce } from './domain/permits/in-force';
export {
  buildReadinessFacts,
  type ReadinessFactsInput,
} from './application/readiness-facts';
export type { ReadinessRulesState } from './application/readiness-rules-service';
// Здесь только то, что безопасно на клиенте: этот барьер импортируют
// клиентские компоненты контура ТО ради правил и подсчёта баллов. Всё, что
// трогает базу или отправку, ввозится маршрутами напрямую из
// `application/**` — экспорт такого модуля отсюда утаскивает `lib/db` в
// клиентский бандл и роняет приложение целиком (поймано 04.09.2026).

export {
  effectiveReadinessCapabilities,
  READINESS_ABILITIES,
  resolveReadinessCapabilities,
} from './application/capabilities';
export type {
  ReadinessAbility,
  ReadinessRole,
} from './application/capabilities';
export type {
  AccessMatrixState,
} from './application/access-matrix-service';
export type {
  OperatorShiftFacts,
} from './application/operator-shift-query';
export type {
  ReadinessAccessMatrix,
} from './domain/access-matrix';
export {
  DEFECT_SEVERITIES,
  DEFECT_SEVERITY_HINTS,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
} from './domain/defects/types';
export type {
  DefectSeverity,
} from './domain/defects/types';
export {
  normalizeTenantTimezone,
} from './domain/shifts/tenant-production-date';
export {
  SHIFT_STATES,
} from './domain/shifts/types';
