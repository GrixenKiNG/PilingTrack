import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { resolveFuelConsumption, summarizeManualFuel, type ManualFuelReading } from '../../domain/fuel-consumption';

interface EquipmentFuel { equipmentId: string; fuelTankLiters: number | null }
interface BeforeReading extends ManualFuelReading { equipmentId: string }

/** Общая полуоткрытая граница [from, to) для журнала и аналитики, без N+1 по парку. */
export async function readFuelConsumptions(
  equipment: readonly EquipmentFuel[], tenantId: string, from: Date, to: Date, siteId?: string | null,
) {
  if (!tenantId) throw new ServiceError('Не определена организация пользователя', 400);
  const ids = equipment.map((row) => row.equipmentId);
  const [telemetry, entries, before] = await Promise.all([
    db.telemetryRecord.findMany({
      where: { tenantId, equipmentId: { in: ids }, type: 'fuel_total', timestamp: { gte: from, lt: to }, ...(siteId ? { siteId } : {}) },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      select: { equipmentId: true, value: true, timestamp: true },
    }),
    // У ручного журнала нет объекта: при site-фильтре нельзя выдать весь баланс установки за баланс объекта.
    siteId ? Promise.resolve([]) : db.fuelLog.findMany({
      where: { tenantId, equipmentId: { in: ids }, source: 'MANUAL', recordedAt: { gte: from, lt: to } },
      orderBy: [{ recordedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { equipmentId: true, recordedAt: true, tankPercent: true, litersAdded: true },
    }),
    siteId ? Promise.resolve([] as BeforeReading[]) : db.$queryRaw<BeforeReading[]>`
      SELECT DISTINCT ON ("equipmentId") "equipmentId", "recordedAt", "tankPercent", "litersAdded"
      FROM "FuelLog"
      WHERE "tenantId" = ${tenantId} AND "equipmentId" = ANY(${ids}::text[])
        AND source = 'MANUAL' AND "recordedAt" < ${from} AND "tankPercent" IS NOT NULL
      ORDER BY "equipmentId", "recordedAt" DESC, "createdAt" DESC, id DESC
    `,
  ]);
  const telemetryByEquipment = groupByEquipment(telemetry);
  const manualByEquipment = groupByEquipment(entries);
  const beforeByEquipment = new Map(before.map((entry) => [entry.equipmentId, entry]));
  return new Map(equipment.map((row) => {
    const manual = summarizeManualFuel(row.fuelTankLiters,
      manualByEquipment.get(row.equipmentId) ?? [],
      beforeByEquipment.get(row.equipmentId) ?? null);
    const consumption = resolveFuelConsumption(telemetryByEquipment.get(row.equipmentId) ?? [], manual.liters, manual.entryCount > 0 || manual.startPercent != null);
    return [row.equipmentId, { ...manual, consumption }] as const;
  }));
}

function groupByEquipment<T extends { equipmentId: string }>(entries: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const entry of entries) {
    const group = grouped.get(entry.equipmentId);
    if (group) group.push(entry);
    else grouped.set(entry.equipmentId, [entry]);
  }
  return grouped;
}
