/**
 * Equipment Aggregate Root
 */
import { createEquipmentEvent, EquipmentDomainEvent } from './equipment.events';
export interface EquipmentInfo {
  id: string; name: string; model: string; qty: number; description: string; isActive: boolean;
  createdAt: string; updatedAt: string;
}
export interface EquipmentCreateData {
  name: string; model?: string; qty?: number; description?: string;
}
export class EquipmentAggregate {
  private state: EquipmentInfo;
  private pendingEvents: EquipmentDomainEvent[] = [];
  private constructor(state: EquipmentInfo) { this.state = { ...state }; }
  static create(data: EquipmentCreateData, userId?: string): EquipmentAggregate {
    if (!data.name?.trim()) throw new Error('Equipment name is required');
    const now = new Date().toISOString();
    const state: EquipmentInfo = { id: crypto.randomUUID(), name: data.name.trim(), model: data.model || '', qty: data.qty || 1, description: data.description || '', isActive: true, createdAt: now, updatedAt: now };
    const agg = new EquipmentAggregate(state);
    agg.pendingEvents.push(createEquipmentEvent('EquipmentCreated', state.id, { name: state.name, model: state.model, qty: state.qty }, { userId }));
    return agg;
  }
  static reconstitute(state: EquipmentInfo): EquipmentAggregate { return new EquipmentAggregate(state); }
  update(data: { name?: string; model?: string; qty?: number; description?: string }, userId?: string): void {
    if (data.name !== undefined) { if (!data.name.trim()) throw new Error('Name required'); this.state.name = data.name.trim(); }
    if (data.model !== undefined) this.state.model = data.model;
    if (data.qty !== undefined) this.state.qty = data.qty;
    if (data.description !== undefined) this.state.description = data.description;
    this.state.updatedAt = new Date().toISOString();
    this.pendingEvents.push(createEquipmentEvent('EquipmentUpdated', this.state.id, { changes: data }, { userId }));
  }
  retire(userId?: string): void {
    this.state.isActive = false;
    this.state.updatedAt = new Date().toISOString();
    this.pendingEvents.push(createEquipmentEvent('EquipmentRetired', this.state.id, {}, { userId }));
  }
  getState(): Readonly<EquipmentInfo> { return { ...this.state }; }
  getPendingEvents(): ReadonlyArray<EquipmentDomainEvent> { return [...this.pendingEvents]; }
  clearPendingEvents(): void { this.pendingEvents = []; }
  toPersistence() { return { id: this.state.id, name: this.state.name, model: this.state.model, qty: this.state.qty, description: this.state.description, isActive: this.state.isActive }; }
}
export { createEquipmentEvent };
export type { EquipmentDomainEvent, EquipmentDomainEventType } from './equipment.events';
