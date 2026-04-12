/**
 * Report Domain Events
 *
 * All events specific to the Reports bounded context.
 * Each event is an immutable fact — something that already happened (past tense).
 */

export type ReportDomainEventType =
  | 'ReportCreated'
  | 'ReportUpdated'
  | 'ReportSubmitted'
  | 'ReportDeleted'
  | 'ReportVersionCreated'
  | 'PileWorkAdded'
  | 'PileWorkRemoved'
  | 'DrillingAdded'
  | 'DrillingRemoved'
  | 'DowntimeAdded'
  | 'DowntimeRemoved';

export interface ReportDomainEvent {
  id: string;
  type: ReportDomainEventType;
  aggregateId: string;
  aggregateType: 'Report';
  occurredAt: string;
  userId?: string;
  tenantId?: string;
  siteId?: string;
  version?: number;
  metadata?: Record<string, unknown>;
  data: Record<string, unknown>;
}

export function createReportEvent(
  type: ReportDomainEventType,
  aggregateId: string,
  data: Record<string, unknown>,
  options?: {
    userId?: string;
    tenantId?: string;
    siteId?: string;
    version?: number;
    metadata?: Record<string, unknown>;
  }
): ReportDomainEvent {
  return {
    id: crypto.randomUUID(),
    type,
    aggregateId,
    aggregateType: 'Report',
    occurredAt: new Date().toISOString(),
    userId: options?.userId,
    tenantId: options?.tenantId,
    siteId: options?.siteId,
    version: options?.version,
    metadata: options?.metadata,
    data,
  };
}
