/**
 * Заказ пересчёта готовности. Запись события живёт в `core/outbox`: её вызывают
 * и модули, которым нельзя зависеть от готовности (equipment, inspections).
 * Здесь — прежнее имя для кода самого модуля готовности.
 */
export {requestReadinessSnapshot, type ReadinessSnapshotRequest} from '@/core/outbox/readiness-snapshot-request';
