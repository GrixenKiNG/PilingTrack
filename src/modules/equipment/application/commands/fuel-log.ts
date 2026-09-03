/**
 * FuelLog — журнал топлива: долив в бак и остаток по указателю.
 *
 * Источник истины по топливу — история записей, а не одно поле. Расход
 * отдельным числом НЕ храним: он выводится из долива, остатка и объёма бака.
 * Моточасы для «л/моточас» берём из MeterReading — второй копии наработки
 * здесь нет, иначе получилось бы ровно то расхождение, от которого уводит вся
 * модель «источник → производная».
 *
 * Точная телеметрия появится, когда на бак поставят датчик: она будет писать
 * сюда с source='TELEMETRY' и вытеснять ручной ввод. Ручной учёт при этом не
 * выбрасывается — становится резервным источником. Схема не меняется.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type { MeterSource } from './meter-reading';

export interface FuelLogInput {
  /** Сколько залито в бак за эту запись, л. */
  litersAdded?: number | null;
  /** Остаток по указателю на момент записи, % (0–100). */
  tankPercent?: number | null;
  recordedAt?: string | Date | null;
  source?: MeterSource;
  note?: string | null;
}

export interface FuelLogContext {
  tenantId: string;
  recordedById?: string | null;
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const asInt = (v: number | null | undefined): number | null =>
  v == null ? null : Math.trunc(v);

export interface FuelConsumptionInput {
  /** Объём бака, л. Без него остаток в % не перевести в литры. */
  tankLiters: number | null;
  /** Остаток в начале периода, %. */
  startPercent: number | null;
  /** Остаток в конце периода, %. */
  endPercent: number | null;
  /** Сумма долива за период, л. */
  litersAdded: number;
  /** Прирост моточасов за период (из MeterReading). */
  engineHoursDelta: number | null;
}

export interface FuelConsumption {
  /** Израсходовано за период, л. null — если данных не хватает (честно, без выдумки). */
  consumedLiters: number | null;
  /** Расход, л/моточас. null — если расход или наработку посчитать нельзя. */
  perEngineHour: number | null;
}

/**
 * Расход за период. Чистая функция — чтобы правило было одно и покрывалось
 * тестом, а не считалось на глаз в двух местах.
 *
 * Физика простая: сожгли = долили + (было в баке − осталось). «Было − осталось»
 * считается из процентов и объёма бака. Если объёма бака или замеров остатка
 * нет — расход неизвестен, и мы возвращаем null, а не подставляем ноль:
 * ложная цифра расхода хуже честного прочерка.
 */
export function computeFuelConsumption(input: FuelConsumptionInput): FuelConsumption {
  const { tankLiters, startPercent, endPercent, litersAdded, engineHoursDelta } = input;

  const canDeriveTankDelta =
    tankLiters != null && tankLiters > 0 && startPercent != null && endPercent != null;

  const consumedLiters = canDeriveTankDelta
    ? Math.round(litersAdded + (tankLiters * (startPercent - endPercent)) / 100)
    : null;

  const perEngineHour =
    consumedLiters != null && consumedLiters >= 0 && engineHoursDelta != null && engineHoursDelta > 0
      ? Math.round((consumedLiters / engineHoursDelta) * 10) / 10
      : null;

  return { consumedLiters, perEngineHour };
}

export async function addFuelEntry(
  equipmentId: string,
  input: FuelLogInput,
  ctx: FuelLogContext,
): Promise<{ id: string; recordedAt: Date }> {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)

  const litersAdded = asInt(input.litersAdded);
  const tankPercent = asInt(input.tankPercent);

  // Хотя бы одно из двух должно быть — иначе запись ни о чём.
  if (litersAdded == null && tankPercent == null) {
    throw new ServiceError('Укажите долив в литрах или остаток в %', 400);
  }
  if (litersAdded != null && litersAdded < 0) {
    throw new ServiceError('Долив не может быть отрицательным', 400);
  }
  if (tankPercent != null && (tankPercent < 0 || tankPercent > 100)) {
    throw new ServiceError('Остаток топлива — от 0 до 100 %', 400);
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  const entry = await db.fuelLog.create({
    data: {
      tenantId: ctx.tenantId,
      equipmentId,
      recordedAt: toDate(input.recordedAt) ?? new Date(),
      litersAdded,
      tankPercent,
      source: input.source ?? 'MANUAL',
      recordedById: ctx.recordedById ?? null,
      note: input.note?.trim() ?? '',
    },
    select: { id: true, recordedAt: true },
  });

  return entry;
}

export async function deleteFuelEntry(
  equipmentId: string,
  entryId: string,
  ctx: { tenantId: string },
): Promise<void> {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)
  const existing = await db.fuelLog.findUnique({
    where: { id: entryId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Fuel entry not found', 404);
  }
  await db.fuelLog.delete({ where: { id: entryId } });
}
