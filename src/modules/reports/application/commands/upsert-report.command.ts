/**
 * Upsert Report Command — DTO
 */

export interface UpsertReportCommand {
  reportId: string;
  siteId: string;
  userId: string;
  tenantId?: string;
  /**
   * Optimistic-concurrency token: the version the client loaded and edited.
   * When set, the repository rejects the save with 409 if the stored row has
   * since advanced. Undefined → no check (last-write-wins, offline-safe).
   */
  expectedVersion?: number;
  date: string;
  shiftType?: 'DAY' | 'NIGHT';
  shiftStart?: string | null;
  shiftEnd?: string | null;
  equipmentId?: string | null;
  piles?: Array<{ id?: string; picketId?: string; pileGradeId: string; count: number }>;
  drillings?: Array<{ id?: string; picketId?: string; typeId: string; count?: number; metersPerUnit?: number; meters: number }>;
  downtimes?: Array<{ id?: string; reasonId: string; duration: number; comment?: string }>;
}

export interface UpsertReportResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
  report: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
  events: readonly any[];
  _action: 'created' | 'updated';
}
