import type {Prisma} from '@/generated/postgres-client/client';
import {opensRepairOrder} from '../../domain/defects/repair-order';
import type {DefectSeverity} from '../../domain/defects/types';

/**
 * Заводит заявку на ТО (REPAIR, PLANNED) под дефект высокого или критического
 * уровня. Возвращает id заявки либо null, если уровень ручной. Вызывающий код
 * сам записывает id в дефект: заявка создаётся раньше дефекта, поэтому дефект
 * сразу рождается с привязкой и не требует второй записи.
 */
export async function createRepairOrderForDefect(
  tx: Pick<Prisma.TransactionClient, 'maintenanceRecord'>,
  input: {tenantId: string; equipmentId: string; defectTitle: string; severity: DefectSeverity; actorId: string},
): Promise<string | null> {
  if (!opensRepairOrder(input.severity)) return null;
  const record = await tx.maintenanceRecord.create({
    data: {
      tenantId: input.tenantId,
      equipmentId: input.equipmentId,
      type: 'REPAIR',
      status: 'PLANNED',
      title: `Устранение дефекта: ${input.defectTitle}`,
      description: 'Создано автоматически при фиксации дефекта.',
      // Приоритет наряда остаётся «Высокий» и для критического дефекта: открытый
      // наряд «Критичный» сам блокирует готовность и продлил бы блок после закрытия дефекта.
      priority: 'HIGH',
      createdById: input.actorId,
    },
    select: {id: true},
  });
  return record.id;
}
