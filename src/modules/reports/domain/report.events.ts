/**
 * Report Domain Events
 *
 * Canonical event names inside the reports bounded context use PascalCase.
 * Older dotted aliases are normalized at the boundaries for backward compatibility.
 */

import type { ReportDomainEventType } from './report-event-types';

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

export type { ReportDomainEventType } from './report-event-types';
export {
  REPORT_DOMAIN_EVENT_TYPES,
  normalizeReportDomainEventType,
  isReportDomainEventType,
} from './report-event-types';
