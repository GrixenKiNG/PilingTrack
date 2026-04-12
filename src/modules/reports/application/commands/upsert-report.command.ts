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
  report: any;
  events: readonly any[];
  _action: 'created' | 'updated';
}
