/**
 * Equipment Domain Events
 */
export type EquipmentDomainEventType = 'EquipmentCreated' | 'EquipmentUpdated' | 'EquipmentRetired';
export interface EquipmentDomainEvent {
  id: string; type: EquipmentDomainEventType; aggregateId: string; occurredAt: string;
  userId?: string; data: Record<string, unknown>;
}
export function createEquipmentEvent(type: EquipmentDomainEventType, aggregateId: string, data: Record<string, unknown>, options?: { userId?: string }): EquipmentDomainEvent {
  return { id: crypto.randomUUID(), type, aggregateId, occurredAt: new Date().toISOString(), userId: options?.userId, data };
}
