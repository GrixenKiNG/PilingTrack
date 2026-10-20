/**
 * System Module — публичный вход.
 *
 * Диагностика среды выполнения живёт в `application/queries/`; снаружи
 * импортируют только отсюда (`@/modules/system`).
 */
export { getRuntimeDiagnostics } from './application/queries/system-service';

export { describeAuditEvent, type AuditEvent } from '@/modules/audit';
