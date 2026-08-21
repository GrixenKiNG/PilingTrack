import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { requiredBlockTypes, selectBlocks } from '../../domain/block-composition';
import { sectionPhase } from '../../domain/phase-split';

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

/**
 * Есть ли у машины раздел на конец смены.
 *
 * ЗАЧЕМ. Контур смены требует осмотра после работ перед сдачей машины. Если в
 * собранном чек-листе нет ни одного послесменного раздела, требование
 * невыполнимо: кнопка «Осмотр после работ» отвечала бы ошибкой, а смена
 * навсегда оставалась бы на шаге «Работа». Найдено обходом пути 21.08.2026 на
 * Bauer RTG RM20 — у общего блока «База» такого раздела нет.
 *
 * Спрашиваем только заголовки разделов: состав пунктов здесь не нужен, а
 * тянуть его ради одного признака на экран оператора — лишние килобайты в поле.
 */
export async function hasPostShiftSection(tenantId: string, equipmentId: string): Promise<boolean> {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const eq = await db.equipment.findFirst({
    where: { id: equipmentId, tenantId },
    select: { model: true, hammerKind: true, isCombined: true },
  });
  if (!eq) return false;

  const candidates = await db.checklistTemplate.findMany({
    where: {
      tenantId, level: 'EO', isActive: true,
      blockType: { in: requiredBlockTypes(eq) },
    },
    select: {
      id: true, name: true, blockType: true, appliesToModel: true, appliesToHammerKind: true,
      sections: { select: { title: true, order: true } },
    },
  });

  // Выбор блоков — тот же, что и при заведении осмотра: иначе признак говорил
  // бы про один чек-лист, а собирался бы другой.
  const blocks = selectBlocks(
    candidates.map((template) => ({
      ...template,
      sections: template.sections.map((section) => ({ ...section, items: [] })),
    })),
    eq,
  );
  return blocks.some((block) => block.sections.some((section) => sectionPhase(section.title) !== 'PRE_SHIFT'));
}
