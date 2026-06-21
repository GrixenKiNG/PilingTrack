/**
 * Upsert Report Command — DTO
 */

export interface UpsertReportCommand {
  reportId: string;
  siteId: string;
  userId: string;
  tenantId?: string;
  date: string;
  shiftType?: 'DAY' | 'NIGHT';
  shiftStart?: string | null;
  shiftEnd?: string | null;
  equipmentId?: string | null;
  piles?: Array<{ picketId?: string; pileGradeId: string; count: number }>;
  drillings?: Array<{ picketId?: string; typeId: string; count?: number; metersPerUnit?: number; meters: number }>;
  downtimes?: Array<{ reasonId: string; duration: number; comment?: string }>;
}

export interface UpsertReportResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
  report: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
  events: readonly any[];
  _action: 'created' | 'updated';
}
