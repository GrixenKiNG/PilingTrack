/**
 * Site Domain Events
 */

export type SiteDomainEventType =
  | 'SiteCreated'
  | 'SiteUpdated'
  | 'SiteActivated'
  | 'SiteDeactivated';

export interface SiteDomainEvent {
  id: string;
  type: SiteDomainEventType;
  aggregateId: string;
  occurredAt: string;
  userId?: string;
  tenantId?: string;
  siteId?: string;
  data: Record<string, unknown>;
}

export function createSiteEvent(
  type: SiteDomainEventType,
  aggregateId: string,
  data: Record<string, unknown>,
  options?: { userId?: string; tenantId?: string }
): SiteDomainEvent {
  return {
    id: crypto.randomUUID(),
    type,
    aggregateId,
    occurredAt: new Date().toISOString(),
    userId: options?.userId,
    tenantId: options?.tenantId,
    siteId: aggregateId,
    data,
  };
}
