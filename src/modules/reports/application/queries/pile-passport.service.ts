import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import {
  actualRefusalMm,
  suggestAcceptance,
  type PileAcceptanceValue,
} from '@/modules/operator-mobile/domain/pile-passport';

/**
 * Журнал забивки для мастера.
 *
 * ЧЬЁ ЭТО МЕСТО. Машинист забивает сваю и записывает замеры. Принимает её
 * мастер: он отвечает за участок и решает, годится свая или пойдёт на добивку.
 * Диспетчер про сваи не решает — он ведёт смены и разбирает дефекты.
 *
 * ПОЧЕМУ ОТКАЗ СЧИТАЕТСЯ ЗДЕСЬ, А НЕ ХРАНИТСЯ. В паспорте лежат замеры залога;
 * отказ — их частное. Правило одно на весь продукт
 * (`operator-mobile/domain/pile-passport`), и телефон машиниста, и этот экран
 * показывают одно число.
 */

export interface PilePassportRow {
  id: string;
  pileNumber: string;
  drivenAt: string;
  siteName: string;
  operatorName: string;
  recordedByForeman: boolean;
  pileGradeName: string;
  pileLengthM: number | null;
  designHeadLevelM: number | null;
  actualHeadLevelM: number | null;
  drivenDepthM: number | null;
  followerUsed: boolean;
  redriven: boolean;
  refusalSetPenetrationMm: number | null;
  refusalSetBlows: number | null;
  designRefusalMm: number | null;
  /** Считается из замеров залога, в базе не хранится. */
  refusalMm: number | null;
  totalBlows: number | null;
  blowsLastMeter: number | null;
  planDeviationMm: number | null;
  tiltPercent: number | null;
  hammerType: string | null;
  hammerEnergyKj: number | null;
  dropHeightM: number | null;
  note: string | null;
  acceptance: PileAcceptanceValue;
  acceptanceNote: string | null;
  acceptedAt: string | null;
  /** Что подсказать мастеру; `null` — проектного отказа нет, сравнивать нечего. */
  suggestion: { value: PileAcceptanceValue; reason: string } | null;
}

export async function listPilePassports(input: {
  tenantId: string;
  siteId?: string;
  /** Только неразобранные — рабочий список мастера. */
  pendingOnly?: boolean;
  limit?: number;
}): Promise<PilePassportRow[]> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const rows = await db.pilePassport.findMany({
    where: {
      tenantId: input.tenantId,
      ...(input.pendingOnly ? { acceptance: 'PENDING' } : {}),
      ...(input.siteId ? { pileWork: { report: { siteId: input.siteId } } } : {}),
    },
    orderBy: { drivenAt: 'desc' },
    take: Math.min(input.limit ?? 100, 500),
    include: {
      pileWork: {
        select: {
          pileGrade: { select: { name: true, lengthMm: true } },
          report: {
            select: {
              site: { select: { name: true } },
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((row) => {
    const refusalMm = actualRefusalMm({
      penetrationMm: row.refusalSetPenetrationMm,
      blows: row.refusalSetBlows,
    });
    return {
      id: row.id,
      pileNumber: row.pileNumber,
      drivenAt: row.drivenAt.toISOString(),
      siteName: row.pileWork.report?.site?.name ?? '—',
      operatorName: row.pileWork.report?.user?.name ?? '—',
      recordedByForeman: row.recordedByForeman,
      pileGradeName: row.pileWork.pileGrade?.name ?? '—',
      pileLengthM: row.pileWork.pileGrade?.lengthMm != null
        ? row.pileWork.pileGrade.lengthMm / 1000
        : null,
      designHeadLevelM: row.designHeadLevelM,
      actualHeadLevelM: row.actualHeadLevelM,
      drivenDepthM: row.drivenDepthM,
      followerUsed: row.followerUsed,
      redriven: row.redriven,
      refusalSetPenetrationMm: row.refusalSetPenetrationMm,
      refusalSetBlows: row.refusalSetBlows,
      designRefusalMm: row.designRefusalMm,
      refusalMm,
      totalBlows: row.totalBlows,
      blowsLastMeter: row.blowsLastMeter,
      planDeviationMm: row.planDeviationMm,
      tiltPercent: row.tiltPercent,
      hammerType: row.hammerType,
      hammerEnergyKj: row.hammerEnergyKj,
      dropHeightM: row.dropHeightM,
      note: row.note,
      acceptance: row.acceptance as PileAcceptanceValue,
      acceptanceNote: row.acceptanceNote,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      suggestion: suggestAcceptance({ actualRefusalMm: refusalMm, designRefusalMm: row.designRefusalMm }),
    };
  });
}

/**
 * Решение мастера по свае.
 *
 * ПОЧЕМУ РЕШЕНИЕ МОЖНО ПЕРЕСМОТРЕТЬ. Сваю отправили на добивку, добили, отказ
 * сошёлся — и её принимают. Запрет на второе решение заставил бы заводить
 * вторую сваю с тем же номером, то есть врать в журнале.
 *
 * ПОЧЕМУ ОБЯЗАТЕЛЬНА ПРИЧИНА У ДОБИВКИ. «Не принята» без основания —
 * распоряжение, которое машинист не может выполнить: он не знает, что не так.
 */
export async function decidePilePassport(input: {
  tenantId: string;
  passportId: string;
  actorId: string;
  acceptance: 'ACCEPTED' | 'NEEDS_REDRIVE';
  note?: string;
}): Promise<void> {
  if (!input.tenantId) throw new ServiceError('tenantId is required', 400);

  const note = input.note?.trim() || null;
  if (input.acceptance === 'NEEDS_REDRIVE' && !note) {
    throw new ServiceError('Укажите, почему свая идёт на добивку', 400);
  }

  // Строгое равенство по организации: чужой паспорт этим решением не тронуть.
  const updated = await db.pilePassport.updateMany({
    where: { id: input.passportId, tenantId: input.tenantId },
    data: {
      acceptance: input.acceptance,
      acceptedById: input.actorId,
      acceptedAt: new Date(),
      acceptanceNote: note,
    },
  });

  if (updated.count === 0) throw new ServiceError('Паспорт сваи не найден', 404);
}
