/**
 * Equipment metadata updater.
 *
 * The DDD aggregate intentionally only knows about the core lifecycle
 * fields (name / model / qty / description / isActive). Everything in
 * the unified template (passport, tech specs, operation) is metadata —
 * informational, no domain invariants — and is persisted with a direct
 * Prisma update rather than dragged through the aggregate event flow.
 */

import { db } from '@/lib/db';
import type { EquipmentMetadataInput } from '@/lib/validation-schemas';
import { addMeterReading } from './meter-reading';

/** Кто правит карточку — нужно, чтобы наработка попала в журнал от его имени. */
export interface EquipmentMetadataContext {
  tenantId: string;
  actorId?: string | null;
  /** Разрешено ли снижать счётчик (замена счётчика). См. `canDecreaseMeter`. */
  allowDecrease?: boolean;
}

// Whitelist — copying input keys directly into a Prisma update payload
// is safe only against this list; nothing else from the body slips into
// the database.
const METADATA_KEYS = [
  // A. Identification
  'inventoryNumber',
  'registrationNumber',
  'kind',
  'baseVehicle',
  'serialNumber',
  'manufactureYear',
  'vin',
  // B. Technical specs (unified template)
  'weightTons',
  'weightWithEquipmentTons',
  'heightMm',
  'lengthMm',
  'widthMm',
  'engineBrand',
  'engineSerialNumber',
  'enginePower',
  'maxPileLength',
  'maxDrillingDepth',
  'hammerType',
  'hammerSerialNumber',
  'hammerEnergyKj',
  'hammerKind',
  'isCombined',
  // C. Operation
  'purchaseDate',
  'purchasePrice',
  'engineHoursTotal',
  'nextMaintenanceAtHours',
  'nextMaintenanceDate',
  'homeBaseLocation',
] as const;

type MetadataKey = (typeof METADATA_KEYS)[number];

/**
 * Apply only the metadata subset of an equipment update. Empty strings
 * (from `<input>` cleared by the user) are normalized to NULL so the
 * DB never contains "" — keeps queries and exports clean.
 *
 * Returns true if anything was written.
 */
export async function updateEquipmentMetadata(
  equipmentId: string,
  input: Partial<EquipmentMetadataInput>,
  ctx: EquipmentMetadataContext,
): Promise<boolean> {
  const data: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    if (!(key in input)) continue;
    const raw = (input as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    // '' from blank text inputs → NULL in DB
    data[key as MetadataKey] = raw === '' ? null : raw;
  }

  // Наработка — не обычное поле карточки, а показание счётчика.
  //
  // Раньше она писалась сюда напрямую, в обход журнала, и правка держалась
  // ровно до следующего ввода оператора: `recordMeterReadingInTx`
  // пересчитывает `engineHoursTotal` из последнего показания и молча
  // возвращал прежнюю цифру. Теперь правка заводит показание, и кэш
  // синхронизируется тем же путём, что при вводе с машины.
  //
  // Обнуление поля («наработка неизвестна») показанием не является и пишется
  // по-прежнему напрямую.
  const hours = data.engineHoursTotal;
  const recordAsReading = typeof hours === 'number';
  if (recordAsReading) delete data.engineHoursTotal;

  const wroteMetadata = Object.keys(data).length > 0;
  if (wroteMetadata) {
    await db.equipment.update({
      where: { id: equipmentId },
      data,
    });
  }

  if (recordAsReading) {
    await addMeterReading(
      equipmentId,
      { engineHours: hours as number, note: 'Правка наработки в карточке установки' },
      { tenantId: ctx.tenantId, recordedById: ctx.actorId ?? null, allowDecrease: ctx.allowDecrease },
    );
  }

  return wroteMetadata || recordAsReading;
}
