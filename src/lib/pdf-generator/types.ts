import type PDFDocument from 'pdfkit';

export interface PeriodPdfData {
  dateFrom: string;
  dateTo: string;
  siteId: string;
  reports: unknown[];
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
}

export interface SingleReportData {
  reportId: string;
  date: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftType: string;
  status: string;
  lastEditedByName: string | null;
  lastEditedByRole: string | null;
  assistantName: string;
  equipmentName: string;
  user: { name: string } | null;
  site: { name: string } | null;
  piles: { pileGrade: { name: string }; count: number; metersPerUnit?: number }[];
  drillings: { type: { name: string }; count?: number; metersPerUnit?: number; meters: number }[];
  downtimes: { reason: { name: string }; duration: number; comment: string | null }[];
}

export type PdfJobData = PeriodPdfData | SingleReportData;

export type PdfDoc = InstanceType<typeof PDFDocument>;

export interface FontPaths {
  Regular: string;
  Bold: string;
  Oblique: string;
  BoldOblique: string;
  Serif: string;
  SerifBold: string;
}

export interface PeriodReportRow {
  reportId?: string | null;
  date?: string | null;
  shiftType?: string | null;
  status?: string | null;
  assistantName?: string | null;
  equipmentName?: string | null;
  user?: { name?: string | null } | null;
  site?: { name?: string | null } | null;
  piles?: Array<{ pileGrade?: { name?: string | null } | null; count?: number | null; metersPerUnit?: number | null }> | null;
  drillings?: Array<{ type?: { name?: string | null } | null; count?: number | null; meters?: number | null }> | null;
  downtimes?: Array<{ reason?: { name?: string | null } | null; duration?: number | null; comment?: string | null }> | null;
}
