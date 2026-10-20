/**
 * Server API of the reports module: event bus, outbox, projections handlers, report audit.
 * Kept free of next/server so workers can import it (see src/workers/__tests__/no-next-in-workers.test.ts).
 */
export {
  computeDiff,
  recordPostCommitAuditEvent,
  writeReportAuditRow,
} from './application/audit-service';
export type {
  AuditRecord,
} from './application/audit-service';
export {
  emitDomainEvent,
  getHandlerCount,
  getRegisteredEventTypes,
  on,
} from './application/domain-events';
export type {
  DomainEvent,
  DomainEventType,
} from './application/domain-events';
export {
  recomputeSiteDailySummary,
  REPORT_PDF_DELIVERY_EVENT,
  registerAllEventHandlers,
} from './application/event-handlers';
export {
  getOutboxStats,
  projectOutboxEvents,
  publishOutboxEvents,
  saveToOutbox,
  startOutboxWorker,
  TELEGRAM_LANE_EVENT_TYPES,
} from './application/outbox-publisher';
