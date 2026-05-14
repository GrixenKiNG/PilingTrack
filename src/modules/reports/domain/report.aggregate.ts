/**
 * Report Aggregate Root
 *
 * Инкапсулирует всю бизнес-логику отчёта:
 * - добавление свай/бурения/простоев
 * - валидация бизнес-правил
 * - генерация domain events
 * - переходы состояний (draft → submitted)
 *
 * НЕ знает о БД, API, UI — чистая бизнес-логика.
 */

import { createReportEvent, ReportDomainEvent } from './report.events';

// ============================================================
// Value Objects
// ============================================================

export interface PileWorkEntry {
  pileGradeId: string;
  count: number;
  picketId?: string;
}

export interface DrillingEntry {
  typeId: string;
  count: number;
  metersPerUnit: number;
  meters: number;
  picketId?: string;
}

export interface DowntimeEntry {
  reasonId: string;
  duration: number;
  comment?: string;
}

export type ReportStatus = 'draft' | 'submitted';
export type ShiftType = 'DAY' | 'NIGHT';

// ============================================================
// Aggregate State
// ============================================================

interface ReportState {
  id: string;
  reportId: string;
  userId: string;
  siteId: string;
  tenantId?: string;
  date: string;
  shiftType: ShiftType;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  equipmentId?: string | null;
  status: ReportStatus;
  piles: PileWorkEntry[];
  drillings: DrillingEntry[];
  downtimes: DowntimeEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
  lastEditedById?: string | null;
  lastEditedByName?: string | null;
  lastEditedByRole?: string | null;
}

// ============================================================
// Business Rules
// ============================================================

const MAX_DOWNTIME_PER_SHIFT = 1440; // minutes (24h)
const MAX_PILE_COUNT = 9999;
const MAX_DRILLING_METERS = 99999;

// ============================================================
// Report Aggregate
// ============================================================

export class ReportAggregate {
  private state: ReportState;
  private pendingEvents: ReportDomainEvent[] = [];

  private constructor(state: ReportState) {
    this.state = { ...state };
  }

  // ============================================================
  // Factory Methods
  // ============================================================

  static create(params: {
    reportId: string;
    userId: string;
    siteId: string;
    tenantId?: string;
    date: string;
    shiftType?: ShiftType;
    shiftStart?: string | null;
    shiftEnd?: string | null;
    equipmentId?: string | null;
  }): ReportAggregate {
    const now = new Date().toISOString();
    const state: ReportState = {
      id: crypto.randomUUID(),
      reportId: params.reportId,
      userId: params.userId,
      siteId: params.siteId,
      tenantId: params.tenantId,
      date: params.date,
      shiftType: params.shiftType || 'DAY',
      shiftStart: params.shiftStart,
      shiftEnd: params.shiftEnd,
      equipmentId: params.equipmentId,
      status: 'draft',
      piles: [],
      drillings: [],
      downtimes: [],
      version: 0,
      createdAt: now,
      updatedAt: now,
    };

    const aggregate = new ReportAggregate(state);

    aggregate.pendingEvents.push(
      createReportEvent('ReportCreated', params.reportId, {
        userId: params.userId,
        siteId: params.siteId,
        date: params.date,
        shiftType: params.shiftType || 'DAY',
      }, {
        userId: params.userId,
        siteId: params.siteId,
      })
    );

    return aggregate;
  }

  static reconstitute(state: ReportState): ReportAggregate {
    return new ReportAggregate(state);
  }

  // ============================================================
  // Commands (mutate state + generate events)
  // ============================================================

  addPileWork(entry: PileWorkEntry, userId: string): void {
    this.assertDraft();

    if (entry.count < 1) throw new Error('Pile count must be at least 1');
    if (entry.count > MAX_PILE_COUNT) throw new Error(`Pile count cannot exceed ${MAX_PILE_COUNT}`);

    this.state.piles.push(entry);
    this.touch(userId);

    this.pendingEvents.push(
      createReportEvent('PileWorkAdded', this.state.reportId, {
        pileGradeId: entry.pileGradeId,
        count: entry.count,
        picketId: entry.picketId,
      }, {
        userId,
        siteId: this.state.siteId,
        version: this.state.version,
      })
    );
  }

  addDrilling(entry: DrillingEntry, userId: string): void {
    this.assertDraft();

    if (entry.meters < 0) throw new Error('Drilling meters cannot be negative');
    if (entry.meters > MAX_DRILLING_METERS) throw new Error(`Drilling meters cannot exceed ${MAX_DRILLING_METERS}`);

    this.state.drillings.push(entry);
    this.touch(userId);

    this.pendingEvents.push(
      createReportEvent('DrillingAdded', this.state.reportId, {
        typeId: entry.typeId,
        count: entry.count,
        metersPerUnit: entry.metersPerUnit,
        meters: entry.meters,
        picketId: entry.picketId,
      }, {
        userId,
        siteId: this.state.siteId,
        version: this.state.version,
      })
    );
  }

  addDowntime(entry: DowntimeEntry, userId: string): void {
    this.assertDraft();

    if (entry.duration < 0) throw new Error('Downtime duration cannot be negative');
    if (entry.duration > MAX_DOWNTIME_PER_SHIFT) throw new Error(`Downtime cannot exceed ${MAX_DOWNTIME_PER_SHIFT} minutes`);

    const totalDowntime = this.getTotalDowntime() + entry.duration;
    const shiftHours = this.getShiftDurationHours();

    if (shiftHours && totalDowntime > shiftHours * 60) {
      throw new Error(
        `Total downtime (${totalDowntime}min) exceeds shift duration (${shiftHours * 60}min)`
      );
    }

    this.state.downtimes.push(entry);
    this.touch(userId);

    this.pendingEvents.push(
      createReportEvent('DowntimeAdded', this.state.reportId, {
        reasonId: entry.reasonId,
        duration: entry.duration,
        comment: entry.comment,
      }, {
        userId,
        siteId: this.state.siteId,
        version: this.state.version,
      })
    );
  }

  submit(userId: string, actorName?: string, actorRole?: string): void {
    this.assertDraft();

    if (
      this.state.piles.length === 0 &&
      this.state.drillings.length === 0 &&
      this.state.downtimes.length === 0
    ) {
      throw new Error('Report must contain at least pile work, drilling, or a downtime entry');
    }

    this.state.status = 'submitted';
    this.state.lastEditedById = userId;
    this.state.lastEditedByName = actorName || null;
    this.state.lastEditedByRole = actorRole || null;
    this.touch(userId);

    this.pendingEvents.push(
      createReportEvent('ReportSubmitted', this.state.reportId, {
        totalPiles: this.getTotalPiles(),
        totalDrilling: this.getTotalDrilling(),
        totalDowntime: this.getTotalDowntime(),
      }, {
        userId,
        siteId: this.state.siteId,
        version: this.state.version,
      })
    );
  }

  updateShiftInfo(params: {
    shiftStart?: string | null;
    shiftEnd?: string | null;
    equipmentId?: string | null;
    shiftType?: ShiftType;
  }, userId: string): void {
    this.assertDraft();

    if (params.shiftStart !== undefined) this.state.shiftStart = params.shiftStart;
    if (params.shiftEnd !== undefined) this.state.shiftEnd = params.shiftEnd;
    if (params.equipmentId !== undefined) this.state.equipmentId = params.equipmentId;
    if (params.shiftType !== undefined) this.state.shiftType = params.shiftType;

    this.touch(userId);
  }

  // ============================================================
  // Queries (read-only)
  // ============================================================

  getState(): Readonly<ReportState> {
    return { ...this.state };
  }

  getPendingEvents(): ReadonlyArray<ReportDomainEvent> {
    return [...this.pendingEvents];
  }

  clearPendingEvents(): void {
    this.pendingEvents = [];
  }

  getTotalPiles(): number {
    return this.state.piles.reduce((sum, p) => sum + p.count, 0);
  }

  getTotalDrilling(): number {
    return this.state.drillings.reduce((sum, d) => sum + d.meters, 0);
  }

  getTotalDowntime(): number {
    return this.state.downtimes.reduce((sum, d) => sum + d.duration, 0);
  }

  // ============================================================
  // Persistence helpers
  // ============================================================

  toPersistence() {
    return {
      id: this.state.id,
      reportId: this.state.reportId,
      userId: this.state.userId,
      siteId: this.state.siteId,
      tenantId: this.state.tenantId,
      date: this.state.date,
      shiftType: this.state.shiftType,
      shiftStart: this.state.shiftStart,
      shiftEnd: this.state.shiftEnd,
      equipmentId: this.state.equipmentId,
      status: this.state.status,
      version: this.state.version,
      lastEditedById: this.state.lastEditedById,
      lastEditedByName: this.state.lastEditedByName,
      lastEditedByRole: this.state.lastEditedByRole,
      createdAt: this.state.createdAt,
      updatedAt: this.state.updatedAt,
      piles: this.state.piles,
      drillings: this.state.drillings,
      downtimes: this.state.downtimes,
    };
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private assertDraft(): void {
    if (this.state.status !== 'draft') {
      throw new Error('Report is already submitted and cannot be modified');
    }
  }

  private touch(userId: string): void {
    this.state.updatedAt = new Date().toISOString();
    this.state.version++;
    this.state.lastEditedById = this.state.lastEditedById || userId;
  }

  private getShiftDurationHours(): number | null {
    if (!this.state.shiftStart || !this.state.shiftEnd) return null;

    const [startH, startM] = this.state.shiftStart.split(':').map(Number);
    const [endH, endM] = this.state.shiftEnd.split(':').map(Number);

    let hours = (endH * 60 + endM - startH * 60 - startM) / 60;
    if (hours < 0) hours += 24;

    return hours;
  }
}
