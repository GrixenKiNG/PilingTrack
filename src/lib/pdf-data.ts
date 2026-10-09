import { isSubmittedReport } from '@/lib/report-status';
import type { PeriodPdfData, SingleReportData } from '@/lib/pdf-generator';
import { normalizeCrewData } from '@/lib/normalize-crew';
import { logger } from '@/lib/logger';
import type { RawReportRow } from '@/core/infrastructure/raw-queries';

type PeriodReportRecord = RawReportRow;

interface SingleReportContextReport {
  reportId: string;
  userId: string;
  siteId: string;
  tenantId: string | null;
  date: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftType: string;
  status: string;
  endingEngineHours?: number | null;
  endingFuelPercent?: number | null;
  lastEditedByName: string | null;
  lastEditedByRole: string | null;
  equipment: { name: string } | null;
  user: { name: string } | null;
  site: { name: string } | null;
  crew: {
    assistants: { name: string }[];
    equipment: { name: string } | null;
  } | null;
  piles: { pileGrade: { name: string; lengthMm?: number | null }; count: number; metersPerUnit?: number }[];
  drillings: { type: { name: string }; count?: number; metersPerUnit?: number; meters: number }[];
  downtimes: { reason: { name: string }; duration: number; comment: string | null }[];
}

export interface SingleReportPdfContext {
  report: SingleReportContextReport;
  pdfData: SingleReportData;
}

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

async function getReportQueryService() {
  return import('@/modules/reports/application/queries/report-query.service');
}

/**
 * Название компании из настроек организации — для шапки PDF.
 * Без tenantId имени нет (DEFAULT_TENANT_ID не подставляем: он подменил бы
 * организацию чужой). Ошибка чтения настроек PDF не ломает — имя пропускается.
 */
export async function loadCompanyName(tenantId: string | null | undefined): Promise<string | undefined> {
  if (!tenantId) {
    return undefined;
  }
  try {
    const { getSettings } = await import('@/modules/settings');
    const settings = await getSettings(tenantId);
    return settings.companyName || undefined;
  } catch (error) {
    logger.warn('PDF: не удалось прочитать название компании', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Подпись установки для шапки сводного PDF («Отчёт по этой установке»).
 * Читается строго по id вместе с tenantId: без tenantId подписи нет —
 * подставлять чужую установку нельзя. Ошибка чтения PDF не ломает.
 */
async function loadEquipmentLabel(
  equipmentId: string,
  tenantId: string | null | undefined
): Promise<string | undefined> {
  if (!tenantId) {
    return undefined;
  }
  try {
    const db = await getDbClient();
    const equipment = await db.equipment.findFirst({
      where: { id: equipmentId, tenantId },
      select: { name: true, model: true },
    });
    if (!equipment) {
      return undefined;
    }
    return equipment.model
      ? `Установка: ${equipment.name} (${equipment.model})`
      : `Установка: ${equipment.name}`;
  } catch (error) {
    logger.warn('PDF: не удалось прочитать установку', {
      equipmentId,
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function buildFallbackCrewMap(reports: Array<{ userId: string; siteId: string }>) {
  if (reports.length === 0) {
    return new Map<string, unknown>();
  }

  const db = await getDbClient();
  const fallbackCrews = await db.crew.findMany({
    where: {
      isActive: true,
      operatorId: { in: reports.map((report) => report.userId) },
      siteId: { in: reports.map((report) => report.siteId) },
    },
    select: {
      operatorId: true,
      siteId: true,
      assistants: { select: { name: true } },
      equipment: { select: { name: true } },
    },
  });

  return new Map(
    fallbackCrews.map((crew) => [`${crew.operatorId}:${crew.siteId}`, crew])
  );
}

function summarizePeriodReports(reports: PeriodReportRecord[]) {
  return reports.filter(isSubmittedReport).reduce(
    (summary, report) => {
      summary.totalPiles += report.piles?.reduce((sum, pile) => sum + (pile.count || 0), 0) || 0;
      summary.totalDrilling +=
        report.drillings?.reduce((sum, drilling) => sum + (drilling.meters || 0), 0) || 0;
      summary.totalDowntime +=
        report.downtimes?.reduce((sum, downtime) => sum + (downtime.duration || 0), 0) || 0;
      return summary;
    },
    { totalPiles: 0, totalDrilling: 0, totalDowntime: 0 }
  );
}

export async function buildPeriodPdfData(input: {
  dateFrom: string;
  dateTo: string;
  siteId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  equipmentId?: string | null;
}): Promise<PeriodPdfData> {
  const { getReportsByPeriod } = await getReportQueryService();
  const allReports = (await getReportsByPeriod(
    input.dateFrom,
    input.dateTo,
    input.siteId || null,
    input.tenantId || null,
    input.userId || null
  )) as PeriodReportRecord[];

  // Equipment scope is applied here (post-filter) rather than in the raw SQL,
  // so the parametrised period query stays untouched. RawReportRow carries
  // equipmentId, so this is an exact match per rig.
  const reports = input.equipmentId
    ? allReports.filter((report) => report.equipmentId === input.equipmentId)
    : allReports;

  const fallbackCrewByKey = await buildFallbackCrewMap(
    reports.map((report) => ({ userId: report.userId, siteId: report.siteId }))
  );

  const normalizedReports = reports.map((report) => {
    const fallbackCrew = report.crew
      ? null
      : fallbackCrewByKey.get(`${report.userId}:${report.siteId}`) || null;
    const effectiveCrew = report.crew || fallbackCrew;
    const crewData = normalizeCrewData(effectiveCrew);

    return {
      ...report,
      assistantName: crewData.assistantName,
      equipmentName: report.equipment?.name || crewData.equipmentName,
    };
  });

  const summary = summarizePeriodReports(reports);

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    siteId: input.siteId || '',
    reports: normalizedReports,
    totalPiles: summary.totalPiles,
    totalDrilling: summary.totalDrilling,
    totalDowntime: summary.totalDowntime,
    companyName: await loadCompanyName(input.tenantId),
    equipmentLabel: input.equipmentId
      ? await loadEquipmentLabel(input.equipmentId, input.tenantId)
      : undefined,
  };
}

function toSingleReportPdfData(
  report: SingleReportContextReport,
  fallbackCrew: unknown,
  companyName: string | undefined
): SingleReportData {
  const effectiveCrew = report.crew || fallbackCrew;
  const crewData = normalizeCrewData(effectiveCrew);

  return {
    reportId: report.reportId,
    date: report.date,
    shiftStart: report.shiftStart,
    shiftEnd: report.shiftEnd,
    shiftType: report.shiftType,
    status: report.status,
    endingEngineHours: report.endingEngineHours,
    endingFuelPercent: report.endingFuelPercent,
    lastEditedByName: report.lastEditedByName,
    lastEditedByRole: report.lastEditedByRole,
    assistantName: crewData.assistantName,
    equipmentName: report.equipment?.name || crewData.equipmentName,
    user: report.user,
    site: report.site,
    piles: report.piles,
    drillings: report.drillings,
    downtimes: report.downtimes,
    companyName,
  };
}

export async function loadSingleReportPdfContext(
  reportId: string
): Promise<SingleReportPdfContext | null> {
  const db = await getDbClient();
  const report = (await db.report.findUnique({
    where: { reportId },
    include: {
      user: { select: { name: true } },
      site: { select: { name: true } },
      equipment: { select: { name: true } },
      crew: {
        select: {
          name: true,
          assistants: { select: { name: true } },
          equipment: { select: { name: true } },
        },
      },
      piles: { include: { pileGrade: true } },
      drillings: { include: { type: true } },
      downtimes: { include: { reason: true } },
    },
  })) as SingleReportContextReport | null;

  if (!report) {
    return null;
  }

  const fallbackCrew = report.crew
    ? null
    : await db.crew.findFirst({
        where: {
          operatorId: report.userId,
          siteId: report.siteId,
          isActive: true,
        },
        select: {
          assistants: { select: { name: true } },
          equipment: { select: { name: true } },
        },
      });

  return {
    report,
    pdfData: toSingleReportPdfData(report, fallbackCrew, await loadCompanyName(report.tenantId)),
  };
}
