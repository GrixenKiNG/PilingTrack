/**
 * Equipment Command Service
 */
import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { EquipmentAggregate } from '../../domain';
import { getEquipmentRepository } from '../../infrastructure';
import { fromPrismaToState, toOutboxData } from '../../infrastructure/equipment.prisma.mapper';
import { updateEquipmentMetadata } from './equipment-metadata';
import { CreateEquipmentCommand, UpdateEquipmentCommand } from './equipment.command';

export async function createEquipment(cmd: CreateEquipmentCommand) {
  const agg = EquipmentAggregate.create(
    { name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description, tenantId: cmd.tenantId },
    cmd.userId,
  );
  await getEquipmentRepository().save(agg);
  return db.equipment.findUnique({ where: { id: agg.getState().id } });
}

export async function updateEquipment(cmd: UpdateEquipmentCommand) {
  if (cmd.expectedUpdatedAt) {
    return db.$transaction(async (tx) => {
      // Serialize the entire card, including passport and meter writes.
      await tx.$queryRaw`SELECT id FROM "Equipment" WHERE id = ${cmd.equipmentId} AND "tenantId" = ${cmd.tenantId} FOR UPDATE`;
      const current = await tx.equipment.findUnique({ where: { id: cmd.equipmentId, tenantId: cmd.tenantId } });
      if (!current) throw new ServiceError('Установка не найдена', 404);
      if (current.updatedAt.toISOString() !== cmd.expectedUpdatedAt) {
        throw new ServiceError('Карточка изменена другим пользователем. Данные обновлены; проверьте их и повторите правку.', 409);
      }
      const agg = EquipmentAggregate.reconstitute(fromPrismaToState(current));
      agg.update({ name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description, isActive: cmd.isActive }, cmd.userId);
      const state = agg.getState();
      await tx.equipment.update({
        where: { id: cmd.equipmentId, tenantId: cmd.tenantId },
        data: { name: state.name, model: state.model, qty: state.qty, description: state.description, isActive: state.isActive },
      });
      await updateEquipmentMetadata(cmd.equipmentId, cmd.metadata ?? {}, { tenantId: cmd.tenantId, actorId: cmd.userId, allowDecrease: cmd.allowDecrease }, tx as typeof db);
      // Millisecond precision must advance even for two saves in one tick.
      await tx.equipment.update({ where: { id: cmd.equipmentId, tenantId: cmd.tenantId }, data: { updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)) } });
      for (const event of agg.getPendingEvents()) await tx.outboxEvent.create({ data: toOutboxData(event, cmd.tenantId) });
    });
  }
  const repo = getEquipmentRepository();
  const agg = await repo.findById(cmd.equipmentId, cmd.tenantId);
  if (!agg) throw new ServiceError('Установка не найдена', 404);
  agg.update({ name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description, isActive: cmd.isActive }, cmd.userId);
  await repo.save(agg);
}

export async function retireEquipment(equipmentId: string, tenantId: string, userId?: string) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(equipmentId, tenantId);
  if (!agg) throw new ServiceError('Установка не найдена', 404);
  agg.retire(userId);
  await repo.save(agg);
}

export async function deleteEquipment(equipmentId: string, tenantId: string) {
  return db.$transaction(async (tx) => {
    // Блокируем строку установки: чужой INSERT со ссылкой на неё ждёт нашу
    // транзакцию (FK-проверка берёт FOR KEY SHARE), поэтому счётчики ниже
    // видят уже зафиксированную чужую историю, а не гоняются с ней.
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Equipment" WHERE id = ${equipmentId} FOR UPDATE`;

    const existing = await tx.equipment.findUnique({
      where: { id: equipmentId, tenantId },
      select: {
        id: true,
        _count: {
          select: {
            crews: true,
            reports: true,
            shifts: true,
            workPermits: true,
            inspections: true,
            meterReadings: true,
            maintenanceRecords: true,
            maintenancePlans: true,
            fuelLogs: true,
            defects: true,
            documents: true,
            deviceKeys: true,
            telematicsDevices: true,
            telematicsAssignments: true,
            operatorChecklistExecutions: true,
            operatorShiftEvidence: true,
          },
        },
      },
    });
    if (!existing) throw new ServiceError('Установка не найдена', 404);

    // Жёсткое удаление стирает историю каскадом или ломается о RESTRICT-связи,
    // поэтому удалять можно только установку, за которой ничего не осталось.
    // Все остальные выводим из эксплуатации — история при этом сохраняется.
    const history: string[] = [];
    const counts = existing._count;
    if (counts.crews > 0) history.push('бригады');
    if (counts.reports > 0) history.push('отчёты');
    if (counts.shifts > 0) history.push('смены');
    if (counts.workPermits > 0) history.push('наряды-допуски');
    if (counts.inspections > 0) history.push('осмотры');
    if (counts.meterReadings > 0) history.push('показания моточасов');
    if (counts.maintenanceRecords > 0) history.push('наряды ТО');
    if (counts.maintenancePlans > 0) history.push('регламенты ТО');
    if (counts.fuelLogs > 0) history.push('записи топлива');
    if (counts.defects > 0) history.push('дефекты');
    if (counts.documents > 0) history.push('документы');
    if (counts.deviceKeys > 0) history.push('ключи устройств');
    if (counts.telematicsDevices > 0) history.push('телематика');
    if (counts.telematicsAssignments > 0) history.push('привязки телематики');
    if (counts.operatorChecklistExecutions > 0) history.push('чек-листы оператора');
    if (counts.operatorShiftEvidence > 0) history.push('свидетельства смены');

    if (history.length > 0) {
      throw new ServiceError(
        `Нельзя удалить установку: у неё есть история (${history.join(', ')}). Выведите её из эксплуатации — история сохранится.`,
        409,
      );
    }

    try {
      await tx.equipment.delete({ where: { id: equipmentId } });
    } catch (error) {
      // RESTRICT-связь, не попавшая в счётчики (например, добавленная миграцией
      // позже), не должна выглядеть как 500 — это тот же бизнес-отказ.
      const code = (error as { code?: string } | null)?.code;
      const message = error instanceof Error ? error.message : '';
      if (code === 'P2003' || message.includes('FOREIGN KEY')) {
        throw new ServiceError(
          'Нельзя удалить установку: у неё есть история. Выведите её из эксплуатации — история сохранится.',
          409,
        );
      }
      throw error;
    }
    return { success: true };
  });
}
