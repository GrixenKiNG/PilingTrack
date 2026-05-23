/**
 * Site Aggregate Root
 *
 * Manages site lifecycle: create, update, activate/deactivate.
 * Enforces business rules: name required, cannot deactivate site with active reports.
 */

import { createSiteEvent, SiteDomainEvent } from './site.events';

export type SiteStatus = 'ACTIVE' | 'INACTIVE' | 'COMPLETED';

export interface SiteInfo {
  id: string;
  name: string;
  tenantId?: string | null;
  status: SiteStatus;
  plannedPiles: number;
  plannedDrilling: number;
  completionDate?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SiteCreateData {
  name: string;
  tenantId?: string | null;
  plannedPiles?: number;
  plannedDrilling?: number;
  completionDate?: string | null;
}

export class SiteAggregate {
  private state: SiteInfo;
  private pendingEvents: SiteDomainEvent[] = [];

  private constructor(state: SiteInfo) {
    this.state = { ...state };
  }

  static create(data: SiteCreateData, userId?: string): SiteAggregate {
    if (!data.name || data.name.trim().length < 2) {
      throw new Error('Site name must be at least 2 characters');
    }

    const now = new Date().toISOString();
    const state: SiteInfo = {
      id: crypto.randomUUID(),
      name: data.name.trim(),
      tenantId: data.tenantId || null,
      status: 'ACTIVE',
      plannedPiles: data.plannedPiles || 0,
      plannedDrilling: data.plannedDrilling || 0,
      completionDate: data.completionDate || null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const aggregate = new SiteAggregate(state);
    aggregate.pendingEvents.push(
      createSiteEvent('SiteCreated', state.id, {
        name: state.name,
        tenantId: state.tenantId,
        plannedPiles: state.plannedPiles,
        plannedDrilling: state.plannedDrilling,
      }, { userId, tenantId: state.tenantId || undefined })
    );

    return aggregate;
  }

  static reconstitute(state: SiteInfo): SiteAggregate {
    return new SiteAggregate(state);
  }

  // ============================================================
  // Commands
  // ============================================================

  update(data: {
    name?: string;
    plannedPiles?: number;
    plannedDrilling?: number;
    completionDate?: string | null;
  }, userId?: string): void {
    if (data.name !== undefined) {
      if (data.name.trim().length < 2) {
        throw new Error('Site name must be at least 2 characters');
      }
      this.state.name = data.name.trim();
    }
    if (data.plannedPiles !== undefined) this.state.plannedPiles = data.plannedPiles;
    if (data.plannedDrilling !== undefined) this.state.plannedDrilling = data.plannedDrilling;
    if (data.completionDate !== undefined) this.state.completionDate = data.completionDate;

    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createSiteEvent('SiteUpdated', this.state.id, {
        changes: data,
      }, { userId, tenantId: this.state.tenantId || undefined })
    );
  }

  activate(userId?: string): void {
    if (this.state.isActive) return;

    this.state.isActive = true;
    this.state.status = 'ACTIVE';
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createSiteEvent('SiteActivated', this.state.id, {}, { userId })
    );
  }

  deactivate(userId?: string): void {
    if (!this.state.isActive) return;

    // Active-reports guard lives in the command service (deactivateSite)
    // because aggregates must stay pure — they cannot reach the DB.
    // See src/modules/sites/application/commands/site-command.service.ts.
    this.state.isActive = false;
    this.state.status = 'INACTIVE';
    this.state.updatedAt = new Date().toISOString();

    this.pendingEvents.push(
      createSiteEvent('SiteDeactivated', this.state.id, {}, { userId })
    );
  }

  // ============================================================
  // Queries
  // ============================================================

  getState(): Readonly<SiteInfo> {
    return { ...this.state };
  }

  getPendingEvents(): ReadonlyArray<SiteDomainEvent> {
    return [...this.pendingEvents];
  }

  clearPendingEvents(): void {
    this.pendingEvents = [];
  }

  toPersistence() {
    return {
      id: this.state.id,
      name: this.state.name,
      tenantId: this.state.tenantId,
      status: this.state.status,
      plannedPiles: this.state.plannedPiles,
      plannedDrilling: this.state.plannedDrilling,
      completionDate: this.state.completionDate,
      isActive: this.state.isActive,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
    };
  }
}
