// Shared types for admin-reports module

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  siteId?: string;
  userId?: string;
  status?: string;
  shiftType?: string;
}

export interface PeriodSummary {
  totalPiles: number;
  totalDrillingCount?: number;
  totalDrilling: number;
  totalDowntime: number;
  reportCount: number;
  uniqueSites: number;
  uniqueOperators: number;
}

export interface ReportWithDetails {
  id: string;
  reportId: string;
  date: string;
  shiftType: string;
  status: string;
  siteName: string;
  operatorName: string;
  equipmentName?: string;
  crewName?: string;
  piles: Array<{ pileGradeName: string; count: number }>;
  drillings: Array<{ typeName: string; count: number; meters: number }>;
  downtimes: Array<{ reasonName: string; duration: number }>;
  lastEditedByName?: string;
  createdAt: string;
  updatedAt: string;
}
