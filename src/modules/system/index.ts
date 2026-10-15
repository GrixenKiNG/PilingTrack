/**
 * System Module — публичный вход.
 *
 * Диагностика среды выполнения живёт в `application/queries/`; снаружи
 * импортируют только отсюда (`@/modules/system`).
 */
export { getRuntimeDiagnostics } from './application/queries/system-service';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; audit implementation stays in services/
export { describeAuditEvent, type AuditEvent } from '@/services/audit/audit-service';
