import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';
import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from '../commands/equipment-maintenance';

// Safety cap for the cross-fleet work order list. Single-tenant volumes are
// low today; revisit with cursor pagination if a tenant exceeds this.
const MAINTENANCE_LIST_LIMIT = 500;

export async function getAccessibleEquipment(tenantId: string) {
  return db.equipment.findMany({ where: { isActive: true, tenantId }, orderBy: { name: 'asc' } });
}

export async function getEquipmentById(id: string, tenantId: string) {
  return db.equipment.findUnique({
    where: { id, tenantId },
    include: { crews: { select: { id: true, name: true, siteId: true } } },
  });
}

export async function getEquipmentByIdOrThrow(id: string, tenantId: string) {
  const equipment = await db.equipment.findUnique({
    where: { id, tenantId },
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

export async function listEquipmentWithCrewCounts(tenantId: string) {
  const list = await db.equipment.findMany({
    where: { tenantId },
    include: { crews: { where: { isActive: true } } },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return list.map((eq) => ({
    id: eq.id, name: eq.name, model: eq.model, qty: eq.qty,
    isActive: eq.isActive, description: eq.description,
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
 * Rich snapshot for /admin/equipment/[id].
 */
export async function getEquipmentDetails(equipmentId: string, tenantId: string) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId },
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

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const allReports = await db.report.findMany({
    where: { equipmentId },
    orderBy: { date: 'desc' },
    take: 1000,
    select: {
      id: true, reportId: true, date: true, shiftType: true, status: true,
      site: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      updatedAt: true,
    },
  });
  const analyticsRows = allReports.length
    ? await db.reportAnalytics.findMany({
        where: { reportId: { in: allReports.map((r) => r.reportId) } },
        select: { reportId: true, totalPiles: true, totalDrilling: true, totalDowntime: true },
      })
    : [];
  const analyticsByReport = new Map(analyticsRows.map((a) => [a.reportId, a]));

  const reports30d = allReports.filter((r) => r.date >= cutoff);
  const stats30d = reports30d.reduce(
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

  const timeline = allReports.map((r) => {
    const a = analyticsByReport.get(r.reportId);
    return {
      reportId: r.reportId, date: r.date, shiftType: r.shiftType, status: r.status,
      siteName: r.site?.name ?? null, operatorName: r.user?.name ?? null,
      updatedAt: r.updatedAt.toISOString(),
      piles: a?.totalPiles ?? null, drillingMeters: a?.totalDrilling ?? null,
      downtimeMinutes: a?.totalDowntime ?? null,
    };
  });

  return {
    equipment,
    crew: equipment.crews[0] ?? null,
    telematicsDevices: equipment.telematicsDevices,
    documents: equipment.documents,
    stats30d: { reportCount: reports30d.length, ...stats30d },
    timeline,
  };
}

export async function listEquipmentCatalog(tenantId: string) {
  return db.equipment.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
}

/**
 * Журнал ТО/ремонтов установки
 */
export async function listMaintenance(equipmentId: string, tenantId: string) {
  return db.maintenanceRecord.findMany({
    where: { equipmentId, tenantId },
    orderBy: [{ status: 'asc' }, { scheduledAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export interface MaintenanceListFilter {
  status?: MaintenanceStatus;
  priority?: MaintenancePriority;
  assigneeId?: string;
  type?: MaintenanceType;
}

export async function listAllMaintenance(tenantId: string, filter: MaintenanceListFilter = {}) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)
  return db.maintenanceRecord.findMany({
    where: {
      tenantId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    include: { equipment: { select: { id: true, name: true, model: true } } },
    orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
    take: MAINTENANCE_LIST_LIMIT,
  });
}

export async function listAllEquipment(
  pagination?: CursorPaginationResult,
  siteId?: string | null,
  operatorUserId?: string | null,
  tenantId?: string,
) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;
  const where: Record<string, unknown> = {};

  if (tenantId) where.tenantId = tenantId;

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
