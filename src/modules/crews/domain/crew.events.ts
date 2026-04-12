/**
 * Crew Domain Events
 */

export type CrewDomainEventType =
  | 'CrewCreated'
  | 'CrewUpdated'
  | 'CrewAssigned'
  | 'CrewUnassigned'
  | 'CrewDeactivated'
  | 'CrewReactivated';

export interface CrewDomainEvent {
  id: string;
  type: CrewDomainEventType;
  aggregateId: string;
  occurredAt: string;
  userId?: string;
  siteId?: string;
  data: Record<string, unknown>;
}

export function createCrewEvent(
  type: CrewDomainEventType,
  aggregateId: string,
  data: Record<string, unknown>,
  options?: { userId?: string; siteId?: string }
): CrewDomainEvent {
  return {
    id: crypto.randomUUID(),
    type,
    aggregateId,
    occurredAt: new Date().toISOString(),
    userId: options?.userId,
    siteId: options?.siteId,
    data,
  };
}
