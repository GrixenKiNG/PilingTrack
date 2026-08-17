/**
 * Заказ пересчёта готовности из чужих модулей.
 *
 * Снимок готовности заказывали только осмотры, смены, наряды и дефекты. Но в
 * формуле есть ещё «Обслуживание» (20 баллов) и «Моточасы» (15): открытый
 * наряд ТО и наработка относительно nextMaintenanceAtHours читаются
 * авторитетным расчётом напрямую. Из-за этого механик закрывал наряд, а
 * CurrentReadiness оставался прежним до следующего осмотра или запуска смены —
 * 35 баллов из 100 обновлялись с произвольной задержкой.
 *
 * Событие пишется в том же `tx`, что и сама запись: иначе снимок можно
 * заказать под транзакцию, которая потом откатится.
 */

import type {Prisma} from '@/generated/postgres-client/client';
import type {db} from '@/lib/db';

export interface ReadinessSnapshotRequest {
  tenantId: string;
  equipmentId: string;
  /** Запись, из-за которой пересчитываем (наряд ТО, показание счётчика). */
  aggregateId: string;
  aggregateType: string;
  /** Стабильный код повода: MAINTENANCE_CLOSED, METER_READING_RECORDED, … */
  triggerType: string;
  /** Уникален внутри triggerType — по нему снимок дедуплицируется. */
  triggerId: string;
  occurredAt: Date;
  shiftId?: string | null;
}

export async function requestReadinessSnapshot(
  tx: typeof db,
  input: ReadinessSnapshotRequest,
): Promise<void> {
  // skipDuplicates, а не create: совпадение dedupeKey означает «снимок по
  // этому же поводу уже заказан». В Postgres упавший на уникальном индексе
  // запрос отменяет всю транзакцию, поэтому ON CONFLICT DO NOTHING — не
  // оптимизация, а условие того, что вызывающая команда доживёт до конца.
  await tx.outboxEvent.createMany({
    skipDuplicates: true,
    data: [{
      type: 'ReadinessSnapshotRequested',
      tenantId: input.tenantId,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      dedupeKey: `readiness.snapshot:${input.tenantId}:${input.equipmentId}:${input.triggerType}:${input.triggerId}`,
      payload: {
        triggerType: input.triggerType,
        triggerId: input.triggerId,
        equipmentId: input.equipmentId,
        shiftId: input.shiftId ?? undefined,
        triggerOccurredAt: input.occurredAt.toISOString(),
      } as Prisma.InputJsonValue,
    }],
  });
}
