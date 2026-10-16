/**
 * Analytics Module — публичный вход.
 *
 * Запросы живут в `application/queries/`; снаружи импортируют только отсюда
 * (`@/modules/analytics`). Модуль зависит только от `@/lib` и `@/lib/db`.
 */
export { getSiteAnalytics, type SiteAnalyticsOptions } from './application/queries/site-analytics-service';
export { getEquipmentAnalytics, type EquipmentAnalyticsParams } from './application/queries/equipment-analytics-service';
