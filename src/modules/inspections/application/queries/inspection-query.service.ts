import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';

export async function listInspections(
  tenantId: string,
  filter: { equipmentId?: string; level?: string },
  operatorUserId: string | null,
) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.inspection.findMany({
    where: {
      tenantId,
      ...(filter.equipmentId ? { equipmentId: filter.equipmentId } : {}),
      ...(filter.level ? { level: filter.level as never } : {}),
      ...(operatorUserId ? { performedById: operatorUserId } : {}),
    },
    include: { equipment: { select: { id: true, name: true, model: true } } },
    orderBy: { inspectionDate: 'desc' },
    take: 200,
  });
}

/**
 * Unified ТО journal for one machine: every maintenance record (ЕО/ТО/ремонт/
 * неисправность) with the linked inspection's summary (health score, status).
 */
export async function listToJournal(tenantId: string, equipmentId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.maintenanceRecord.findMany({
    where: { tenantId, equipmentId },
    include: {
      inspection: { select: { id: true, healthScore: true, status: true, level: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

/**
 * @param performerId если задан — осмотр обязан принадлежать этому человеку.
 * Так сужается доступ оператора: право проводить осмотр не даёт права читать
 * и править чужие. Офис передаёт null и видит все.
 */
export async function getInspection(id: string, tenantId: string, performerId: string | null = null) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({
    where: { id },
    include: { answers: true, equipment: { select: { id: true, name: true, model: true } } },
  });
  if (!ins || ins.tenantId !== tenantId) throw new ServiceError('Inspection not found', 404);
  // 404, а не 403: чужой осмотр для оператора не существует, и по коду ответа
  // нельзя перебором узнать, какие идентификаторы заняты.
  if (performerId && ins.performedById !== performerId) throw new ServiceError('Inspection not found', 404);
  return ins;
}
