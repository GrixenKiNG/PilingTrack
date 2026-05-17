import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export async function getAccessibleEquipment() { return db.equipment.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }); }
export async function getEquipmentById(id: string) { return db.equipment.findUnique({ where: { id }, include: { crews: { select: { id: true, name: true, siteId: true } } } }); }

export async function getEquipmentByIdOrThrow(id: string) {
  const equipment = await db.equipment.findUnique({
    where: { id },
    include: {
      crews: {
        where: { isActive: true },
        include: {
          operator: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);
  return equipment;
}

export async function listEquipmentWithCrewCounts() {
  const list = await db.equipment.findMany({
    include: { crews: { where: { isActive: true } } },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return list.map((eq) => ({
    id: eq.id, name: eq.name, model: eq.model, qty: eq.qty,
    isActive: eq.isActive, description: eq.description,
    // Template fields — surfaced on the list page so dispatchers can
    // tell at a glance what kind of rig / inventory number something is.
    kind: eq.kind,
    inventoryNumber: eq.inventoryNumber,
    registrationNumber: eq.registrationNumber,
    serialNumber: eq.serialNumber,
    manufactureYear: eq.manufactureYear,
    baseVehicle: eq.baseVehicle,
    crewCount: eq.crews.length,
  }));
}

/**
 * Rich snapshot for /admin/equipment/[id]. One call returns:
 *   - the equipment row with the full template metadata
 *   - active crew (operator + assistants + current site)
 *   - 30-day activity totals from ReportAnalytics
 *   - active telematics devices (when we install boxes — empty for now)
 *   - documents (paspport / OTS / insurance / etc.)
 */
export async function getEquipmentDetails(equipmentId: string) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId },
    include: {
      crews: {
        where: { isActive: true },
        include: {
          operator: { select: { id: true, name: true, email: true } },
          site:     { select: { id: true, name: true } },
          assistants: { select: { id: true, name: true } },
        },
      },
      telematicsDevices: {
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, label: true, provider: true, model: true,
          status: true, lastSeenAt: true, imei: true, installedAt: true,
        },
      },
      documents: {
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
      },
    },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  // 30-day activity aggregation — last report dates are 'YYYY-MM-DD'
  // strings (Report.date is String in the schema, see prisma/schema.prisma).
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const recentReports = await db.report.findMany({
    where: { equipmentId, date: { gte: cutoff } },
    orderBy: { date: 'desc' },
    select: {
      id: true, reportId: true, date: true, shiftType: true, status: true,
      site: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      updatedAt: true,
    },
  });
  const analyticsRows = recentReports.length
    ? await db.reportAnalytics.findMany({
        where: { reportId: { in: recentReports.map((r) => r.reportId) } },
        select: { reportId: true, totalPiles: true, totalDrilling: true, totalDowntime: true },
      })
    : [];
  const analyticsByReport = new Map(analyticsRows.map((a) => [a.reportId, a]));

  const stats30d = recentReports.reduce(
    (acc, r) => {
      const a = analyticsByReport.get(r.reportId);
      if (!a) return acc;
      acc.piles += a.totalPiles;
      acc.drillingMeters += a.totalDrilling;
      acc.downtimeMinutes += a.totalDowntime;
      return acc;
    },
    { piles: 0, drillingMeters: 0, downtimeMinutes: 0 }
  );

  // Timeline: one row per report with totals attached.
  const timeline = recentReports.map((r) => {
    const a = analyticsByReport.get(r.reportId);
    return {
      reportId: r.reportId,
      date: r.date,
      shiftType: r.shiftType,
      status: r.status,
      siteName: r.site?.name ?? null,
      operatorName: r.user?.name ?? null,
      updatedAt: r.updatedAt.toISOString(),
      piles: a?.totalPiles ?? null,
      drillingMeters: a?.totalDrilling ?? null,
      downtimeMinutes: a?.totalDowntime ?? null,
    };
  });

  return {
    equipment,
    crew: equipment.crews[0] ?? null,
    telematicsDevices: equipment.telematicsDevices,
    documents: equipment.documents,
    stats30d: {
      reportCount: recentReports.length,
      ...stats30d,
    },
    timeline,
  };
}
export async function listEquipmentCatalog() {
  return db.equipment.findMany({ orderBy: { name: 'asc' } });
}

export async function listAllEquipment(
  pagination?: CursorPaginationResult,
  siteId?: string | null,
  operatorUserId?: string | null,
) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;
  const where: Record<string, unknown> = {};

  // Operator scope: only equipment they are assigned to via an active crew.
  // Optionally further narrowed to a specific site if siteId is provided.
  if (operatorUserId) {
    where.crews = {
      some: {
        isActive: true,
        operatorId: operatorUserId,
        ...(siteId ? { siteId } : {}),
      },
    };
  }

  return db.equipment.findMany({
    where,
    select: { id: true, name: true, model: true, qty: true, isActive: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}
