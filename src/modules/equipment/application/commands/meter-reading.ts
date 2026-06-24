/**
 * MeterReading — журнал показаний наработки (моточасы).
 *
 * Источник истины наработки — история показаний. Equipment.engineHoursTotal
 * остаётся денормализованным кэшем «последнего показания» (по recordedAt),
 * который синхронизируется здесь на каждое добавление/удаление.
 *
 * Монотонность не форсируется жёстко (счётчик могли заменить, показание могли
 * внести задним числом) — но команда возвращает warning, если новое показание
 * меньше прежде известного максимума. Tenant — строгим равенством (IDOR guard).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';

export type MeterSource = 'MANUAL' | 'TELEMETRY';

export interface MeterReadingInput {
  engineHours: number;
  recordedAt?: string | Date | null;
  source?: MeterSource;
  note?: string | null;
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Latest reading by recordedAt — the value Equipment.engineHoursTotal mirrors. */
async function latestReading(
  tx: typeof db,
  equipmentId: string,
): Promise<{ engineHours: number } | null> {
  return tx.meterReading.findFirst({
    where: { equipmentId },
    orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
    select: { engineHours: true },
  });
}

export interface AddMeterReadingResult {
  reading: { id: string; engineHours: number; recordedAt: Date };
  /** Set when the new reading is below the previously-known latest (possible misread). */
  warning: string | null;
}

export async function addMeterReading(
  equipmentId: string,
  input: MeterReadingInput,
  ctx: { tenantId: string; recordedById?: string | null },
): Promise<AddMeterReadingResult> {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  if (!Number.isInteger(input.engineHours) || input.engineHours < 0) {
    throw new ServiceError('Показание моточасов должно быть целым числом ≥ 0', 400);
  }

  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  const recordedAt = toDate(input.recordedAt) ?? new Date();

  return db.$transaction(async (tx) => {
    const prev = await latestReading(tx as typeof db, equipmentId);
    const warning =
      prev && input.engineHours < prev.engineHours
        ? `Новое показание (${input.engineHours} м/ч) меньше предыдущего (${prev.engineHours} м/ч)`
        : null;

    const reading = await tx.meterReading.create({
      data: {
        tenantId: ctx.tenantId,
        equipmentId,
        engineHours: input.engineHours,
        recordedAt,
        source: input.source ?? 'MANUAL',
        recordedById: ctx.recordedById ?? null,
        note: input.note?.trim() ?? '',
      },
      select: { id: true, engineHours: true, recordedAt: true },
    });

    // Sync the engineHoursTotal cache to the latest reading (which may be this
    // one, or an earlier one if this reading was backdated).
    const latest = await latestReading(tx as typeof db, equipmentId);
    if (latest) {
      await tx.equipment.update({
        where: { id: equipmentId },
        data: { engineHoursTotal: latest.engineHours },
      });
    }

    return { reading, warning };
  });
}

export async function deleteMeterReading(
  equipmentId: string,
  readingId: string,
  ctx: { tenantId: string },
): Promise<void> {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.meterReading.findUnique({
    where: { id: readingId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Meter reading not found', 404);
  }

  await db.$transaction(async (tx) => {
    await tx.meterReading.delete({ where: { id: readingId } });
    const latest = await latestReading(tx as typeof db, equipmentId);
    await tx.equipment.update({
      where: { id: equipmentId },
      data: { engineHoursTotal: latest?.engineHours ?? null },
    });
  });
}
