/**
 * Crew Aggregate Root
 */

import { createCrewEvent, CrewDomainEvent } from './crew.events';

export interface CrewInfo {
  id: string;
  name: string;
  operatorId: string;
  equipmentId: string;
  siteId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrewCreateData {
  name: string;
  operatorId: string;
  equipmentId: string;
  siteId: string;
}

export class CrewAggregate {
  private state: CrewInfo;
  private pendingEvents: CrewDomainEvent[] = [];

  private constructor(state: CrewInfo) {
    this.state = { ...state };
  }

  static create(data: CrewCreateData, userId?: string): CrewAggregate {
    if (!data.name) throw new Error('Crew name is required');
    if (!data.operatorId) throw new Error('Operator is required');
    if (!data.equipmentId) throw new Error('Equipment is required');
    if (!data.siteId) throw new Error('Site is required');

    const now = new Date().toISOString();
    const state: CrewInfo = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      operatorId: data.operatorId,
      equipmentId: data.equipmentId,
      siteId: data.siteId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const aggregate = new CrewAggregate(state);
    aggregate.pendingEvents.push(
      createCrewEvent('CrewCreated', state.id, {
        name: state.name,
        operatorId: state.operatorId,
        equipmentId: state.equipmentId,
        siteId: state.siteId,
      }, { userId, siteId: state.siteId })
    );

    return aggregate;
  }

  static reconstitute(state: CrewInfo): CrewAggregate {
    return new CrewAggregate(state);
  }

  update(data: { name?: string }, userId?: string): void {
    if (data.name !== undefined) {
      if (data.name.trim().length < 1) throw new Error('Crew name cannot be empty');
      this.state.name = data.name.trim();
    }
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createCrewEvent('CrewUpdated', this.state.id, { changes: data }, { userId })
    );
  }

  assignToSite(siteId: string, userId?: string): void {
    this.state.siteId = siteId;
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createCrewEvent('CrewAssigned', this.state.id, { siteId }, { userId, siteId })
    );
  }

  assignOperator(operatorId: string, userId?: string): void {
    this.state.operatorId = operatorId;
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createCrewEvent('CrewOperatorAssigned', this.state.id, { operatorId }, { userId })
    );
  }

  assignEquipment(equipmentId: string, userId?: string): void {
    this.state.equipmentId = equipmentId;
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createCrewEvent('CrewEquipmentAssigned', this.state.id, { equipmentId }, { userId })
    );
  }

  deactivate(userId?: string): void {
    if (!this.state.isActive) throw new Error('Crew is already deactivated');
    this.state.isActive = false;
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createCrewEvent('CrewDeactivated', this.state.id, {}, { userId })
    );
  }

  reactivate(userId?: string): void {
    if (this.state.isActive) throw new Error('Crew is already active');
    this.state.isActive = true;
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createCrewEvent('CrewReactivated', this.state.id, {}, { userId })
    );
  }

  getState(): Readonly<CrewInfo> {
    return { ...this.state };
  }

  getPendingEvents(): ReadonlyArray<CrewDomainEvent> {
    return [...this.pendingEvents];
  }

  clearPendingEvents(): void {
    this.pendingEvents = [];
  }

  toPersistence() {
    return {
      id: this.state.id,
      name: this.state.name,
      operatorId: this.state.operatorId,
      equipmentId: this.state.equipmentId,
      siteId: this.state.siteId,
      isActive: this.state.isActive,
    };
  }
}
