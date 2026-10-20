/**
 * Audit Module — публичный вход. Реализация лежит рядом в этой папке.
 */

export { recordAuditEvent, describeAuditEvent } from './audit-service';
export type { AuditEvent } from './audit-service';
export { getEntityHistory } from './audit-history-service';
export type { AuditHistoryEntry } from './audit-history-service';
