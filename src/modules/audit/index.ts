/**
 * Audit Module — публичный вход. Реализация лежит рядом в этой папке.
 */

export { recordAuditEvent, recordAuditEventInTx, describeAuditEvent } from './audit-service';
export type { AuditEvent, AuditClient } from './audit-service';
export { getEntityHistory } from './audit-history-service';
export type { AuditHistoryEntry } from './audit-history-service';
