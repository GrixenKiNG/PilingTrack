import type {Prisma} from '@/generated/postgres-client/client';
import {requestReadinessSnapshot} from '@/core/outbox/readiness-snapshot-request';
import {ServiceError} from '@/lib/service-error';
import type {DefectSeverity} from '../../domain/defects/types';
import {createRepairOrderForDefect} from './repair-order';

export interface RecordDefectInput {
  tenantId: string;
  equipmentId: string;
  severity: DefectSeverity;
  title: string;
  description: string;
  node?: string | null;
  inspectionId?: string | null;
  shiftId?: string | null;
  reportedById: string;
  reportedAt?: Date;
  /** Ключ источника (пункт осмотра): по нему вызывающий отсекает повторы. */
  sourceKey?: string | null;
  evidenceMediaIds?: Prisma.InputJsonValue;
  /**
   * Заказать пересчёт готовности по этому дефекту. Осмотр механика заказывает на
   * каждый дефект; чек-лист машиниста заказывает один пересчёт на весь осмотр.
   */
  requestSnapshot?: boolean;
}

/**
 * Записать дефект установки вместе с заявкой на ТО — единственное место, где это
 * делается.
 *
 * Дефект высокого и критического уровня сам заводит заявку на ремонт (решение
 * владельца 18.10.2026), и дефект сразу рождается с привязкой к ней. Раньше эту
 * пару писали по отдельности осмотр механика и чек-лист машиниста: правило жило
 * в двух копиях и могло разойтись. Всё — в транзакции вызывающей команды.
 */
export async function recordDefectInTx(
  tx: Pick<Prisma.TransactionClient, 'maintenanceRecord' | 'equipmentDefect' | 'outboxEvent'>,
  input: RecordDefectInput,
): Promise<{id: string; maintenanceRecordId: string | null}> {
  if (!input.tenantId) throw new ServiceError('Не определена организация пользователя', 400); // fail-closed (IDOR guard)

  const maintenanceRecordId = await createRepairOrderForDefect(tx, {
    tenantId: input.tenantId, equipmentId: input.equipmentId, defectTitle: input.title,
    severity: input.severity, actorId: input.reportedById,
  });
  const defect = await tx.equipmentDefect.create({
    data: {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      severity: input.severity,
      status: 'OPEN',
      title: input.title,
      description: input.description,
      node: input.node ?? null,
      inspectionId: input.inspectionId ?? null,
      shiftId: input.shiftId ?? null,
      reportedById: input.reportedById,
      ...(input.reportedAt ? {reportedAt: input.reportedAt} : {}),
      sourceKey: input.sourceKey ?? null,
      ...(input.evidenceMediaIds !== undefined ? {evidenceMediaIds: input.evidenceMediaIds} : {}),
      maintenanceRecordId,
    },
    select: {id: true},
  });
  if (input.requestSnapshot) {
    await requestReadinessSnapshot(tx as never, {
      tenantId: input.tenantId, equipmentId: input.equipmentId,
      aggregateId: defect.id, aggregateType: 'EquipmentDefect',
      triggerType: 'DEFECT_CHANGED', triggerId: `${defect.id}:created`,
      occurredAt: input.reportedAt ?? new Date(),
    });
  }
  return {id: defect.id, maintenanceRecordId};
}
