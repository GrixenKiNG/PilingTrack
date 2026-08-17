import { db } from '@/lib/db';
import type { Prisma } from '@/generated/postgres-client/client';
import { ServiceError } from '@/lib/service-error';
import { recordMeterReadingInTx } from '@/modules/equipment';
import { requestReadinessSnapshot } from '@/modules/readiness/application/projection/request-snapshot';
import { computeHealthScore, findMissing, type SnapItem, type AnswerLike } from '../../domain/inspection-logic';
import { inspectionDefectKey, planDefectsFromInspection, type DefectRuleItem } from '../../domain/defect-rules';
import {
  composeChecklist, selectBlocks, requiredBlockTypes, type CandidateBlock,
} from '../../domain/block-composition';

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

export type MaintenanceLevel = 'EO' | 'TO1' | 'TO2' | 'TO3' | 'SEASONAL';
const LEVEL_TITLE: Record<MaintenanceLevel, string> = {
  EO: 'Ежедневный осмотр и обслуживание',
  TO1: 'Плановое ТО-1',
  TO2: 'Плановое ТО-2',
  TO3: 'Плановое ТО-3',
  SEASONAL: 'Сезонное ТО',
};

/**
 * Start an ЕО/ТО: compose the checklist from blocks (BASE + HAMMER + ROTARY)
 * matching the machine, then create the ТО journal record + its inspection (1:1).
 */
export async function startToInspection(
  input: { equipmentId: string; level: MaintenanceLevel; inspectionDate: string | Date; shift?: string | null; engineHours?: number | null },
  ctx: { tenantId: string; userId: string },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const eq = await db.equipment.findUnique({
    where: { id: input.equipmentId, tenantId: ctx.tenantId },
    select: { id: true, model: true, hammerKind: true, isCombined: true },
  });
  if (!eq) throw new ServiceError('Equipment not found', 404);

  const types = requiredBlockTypes(eq);
  const candidatesRaw = await db.checklistTemplate.findMany({
    where: { tenantId: ctx.tenantId, level: input.level, isActive: true, blockType: { in: types } },
    include: { sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } } },
  });
  const candidates: CandidateBlock[] = candidatesRaw.map((t) => ({
    id: t.id, blockType: t.blockType, name: t.name,
    appliesToModel: t.appliesToModel, appliesToHammerKind: t.appliesToHammerKind,
    sections: t.sections.map((s) => ({
      title: s.title, order: s.order,
      items: s.items.map((i) => ({
        id: i.id, text: i.text, answerType: i.answerType, unit: i.unit, norm: i.norm,
        provenance: i.provenance, required: i.required, photoRequired: i.photoRequired,
        createsDefect: i.createsDefect, defectSeverity: i.defectSeverity, order: i.order,
      })),
    })),
  }));

  const blocks = selectBlocks(candidates, eq);

  // Actionable guard: a checklist needs a BASE block matching the machine model
  // (or a generic BASE with empty model). Tell the admin exactly what to create.
  const baseBlock = blocks.find((b) => b.blockType === 'BASE');
  if (!baseBlock) {
    throw new ServiceError(
      `Нет блока «База» для модели «${eq.model || '—'}» (уровень ${input.level}). ` +
        `Создайте в разделе «Чек-листы» шаблон типа «База» с применимостью «${eq.model || '—'}» ` +
        `или без модели (общий блок для всех машин).`,
      400,
    );
  }

  let snapshot;
  try {
    snapshot = composeChecklist(blocks);
  } catch (e) {
    throw new ServiceError(e instanceof Error ? e.message : 'Не удалось собрать чек-лист', 400);
  }
  const baseTemplateId = baseBlock.id;

  // Sequential create (record → inspection): the FK needs the record id first.
  // Обе записи и заказ снимка — одной транзакцией: начатый осмотр открывает
  // наряд ТО, а открытый наряд авторитетный расчёт считает незакрытой работой.
  // Без пересчёта брошенный осмотр держал бы балл готовности на прежнем
  // значении, хотя запись висит «в работе» (симптом «24 зависших записи ТО»).
  return db.$transaction(async (tx) => {
    const record = await tx.maintenanceRecord.create({
      data: {
        tenantId: ctx.tenantId, equipmentId: eq.id, type: input.level,
        status: 'IN_PROGRESS', title: LEVEL_TITLE[input.level],
        createdById: ctx.userId, startedAt: new Date(),
      },
    });
    const inspection = await tx.inspection.create({
      data: {
        tenantId: ctx.tenantId, equipmentId: eq.id, templateId: baseTemplateId,
        maintenanceRecordId: record.id, level: input.level, performedById: ctx.userId,
        inspectionDate: toDate(input.inspectionDate),
        shift: input.shift ?? null, engineHours: input.engineHours ?? null,
        status: 'DRAFT', templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    await requestReadinessSnapshot(tx as typeof db, {
      tenantId: ctx.tenantId, equipmentId: eq.id,
      aggregateId: inspection.id, aggregateType: 'Inspection',
      triggerType: 'INSPECTION_STARTED', triggerId: inspection.id,
      occurredAt: record.startedAt ?? new Date(),
    });
    return inspection;
  });
}

export async function startInspection(
  input: { equipmentId: string; templateId: string; inspectionDate: string | Date; shift?: string | null; engineHours?: number | null },
  ctx: { tenantId: string; userId: string },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const eq = await db.equipment.findUnique({ where: { id: input.equipmentId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!eq) throw new ServiceError('Equipment not found', 404);
  const tpl = await db.checklistTemplate.findUnique({
    where: { id: input.templateId },
    include: { sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } } },
  });
  if (!tpl || tpl.tenantId !== ctx.tenantId) throw new ServiceError('Template not found', 404);

  const snapshot = tpl.sections.flatMap((s) =>
    s.items.map((i) => ({
      id: i.id, sectionTitle: s.title, text: i.text, answerType: i.answerType,
      unit: i.unit, norm: i.norm, provenance: i.provenance, required: i.required, photoRequired: i.photoRequired,
      createsDefect: i.createsDefect, defectSeverity: i.defectSeverity,
    })),
  );

  return db.inspection.create({
    data: {
      tenantId: ctx.tenantId, equipmentId: eq.id, templateId: tpl.id, level: tpl.level,
      performedById: ctx.userId, inspectionDate: toDate(input.inspectionDate),
      shift: input.shift ?? null, engineHours: input.engineHours ?? null,
      status: 'DRAFT', templateSnapshot: snapshot,
    },
  });
}

export interface AnswerInput { itemId: string; result: string; value?: string | null; note?: string | null; photoCount?: number }

export async function saveAnswers(
  id: string,
  answers: AnswerInput[],
  ctx: { tenantId: string; performerId?: string | null },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({
    where: { id },
    select: { id: true, tenantId: true, status: true, performedById: true },
  });
  if (!ins || ins.tenantId !== ctx.tenantId) throw new ServiceError('Inspection not found', 404);
  // Оператор правит только свой осмотр (см. getInspection про 404).
  if (ctx.performerId && ins.performedById !== ctx.performerId) throw new ServiceError('Inspection not found', 404);
  if (ins.status === 'COMPLETED') throw new ServiceError('Осмотр уже завершён', 409);
  await db.inspectionAnswer.deleteMany({ where: { inspectionId: id } });
  if (answers.length) {
    await db.inspectionAnswer.createMany({
      data: answers.map((a) => ({
        tenantId: ctx.tenantId, inspectionId: id, itemId: a.itemId,
        result: a.result, value: a.value ?? null, note: a.note ?? null, photoCount: a.photoCount ?? 0,
      })),
    });
  }
  return db.inspection.findUnique({ where: { id }, include: { answers: true } });
}

export async function completeInspection(
  id: string,
  ctx: { tenantId: string; signedByName: string; performerId?: string | null },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({ where: { id }, include: { answers: true } });
  if (!ins || ins.tenantId !== ctx.tenantId) throw new ServiceError('Inspection not found', 404);
  // Оператор завершает только свой осмотр (см. getInspection про 404).
  if (ctx.performerId && ins.performedById !== ctx.performerId) throw new ServiceError('Inspection not found', 404);

  const items = (ins.templateSnapshot as unknown as SnapItem[]) ?? [];
  const answers: AnswerLike[] = ins.answers.map((a) => ({ itemId: a.itemId, result: a.result, photoCount: a.photoCount }));
  const { missingAnswers, missingPhotos } = findMissing(items, answers);
  if (missingAnswers.length || missingPhotos.length) {
    throw new ServiceError(
      `Осмотр не заполнен: пунктов без ответа ${missingAnswers.length}, без обязательного фото ${missingPhotos.length}`,
      400,
    );
  }
  const healthScore = computeHealthScore(items, answers);
  // Отрицательные ответы на пункты, помеченные администратором, превращаются в
  // дефекты установки. Правило чистое и лежит в домене (defect-rules.ts).
  const plannedDefects = planDefectsFromInspection({
    items: ins.templateSnapshot as unknown as DefectRuleItem[],
    answers: ins.answers.map((a) => ({ itemId: a.itemId, result: a.result, note: a.note })),
  });
  const now = new Date();
  return db.$transaction(async (tx) => {
    const inspection = await tx.inspection.update({
      where: { id },
      data: { status: 'COMPLETED', healthScore, signedByName: ctx.signedByName, signedAt: now },
    });
    // Запись ТО заводится вместе с осмотром и закрывается вместе с ним. Без
    // этого каждый сменный осмотр навсегда оставался «в работе»: журнал
    // обслуживания копил мнимые незакрытые работы, а производная готовность
    // считала машину требующей внимания сразу после успешного осмотра.
    if (ins.maintenanceRecordId) {
      await tx.maintenanceRecord.updateMany({
        where: { id: ins.maintenanceRecordId, tenantId: ctx.tenantId, status: { not: 'DONE' } },
        data: { status: 'DONE', completedAt: now, engineHoursAtService: ins.engineHours ?? undefined },
      });
    }
    // Моточасы, снятые при осмотре, — это настоящее показание счётчика, и оно
    // обязано попасть в журнал наработки. Раньше число оставалось внутри
    // осмотра: в карточке установки и в критерии готовности «Моточасы»
    // продолжала висеть прежняя цифра, хотя оператор только что снял новую.
    // Пишем той же командой, что и ручной ввод, — с историей и синхронизацией
    // Equipment.engineHoursTotal.
    if (typeof ins.engineHours === 'number' && ins.engineHours >= 0) {
      await recordMeterReadingInTx(tx as typeof db, ins.equipmentId, {
        engineHours: ins.engineHours,
        recordedAt: now,
        source: 'MANUAL',
        note: `Снято при осмотре ${ins.level}`,
      }, { tenantId: ctx.tenantId, recordedById: ins.performedById });
    }
    // Дефекты по отрицательным ответам. Дедупликация обязательна: без неё
    // каждый сменный осмотр заводил бы новую запись на ту же неисправность и
    // журнал утонул бы за неделю. Пока прежний дефект по этому пункту открыт,
    // новый не создаётся — вместо этого запись остаётся одна и живёт своим
    // циклом (разбор → устранение).
    if (plannedDefects.length > 0) {
      const openByKey = await tx.equipmentDefect.findMany({
        where: {
          tenantId: ctx.tenantId,
          equipmentId: ins.equipmentId,
          status: { in: ['OPEN', 'IN_WORK'] },
          sourceKey: { in: plannedDefects.map((item) => inspectionDefectKey(ins.equipmentId, item.itemId)) },
        },
        select: { sourceKey: true },
      });
      const alreadyOpen = new Set(openByKey.map((row) => row.sourceKey));
      const toCreate = plannedDefects.filter((item) =>
        !alreadyOpen.has(inspectionDefectKey(ins.equipmentId, item.itemId)));
      for (const planned of toCreate) {
        const defect = await tx.equipmentDefect.create({
          data: {
            tenantId: ctx.tenantId,
            equipmentId: ins.equipmentId,
            severity: planned.severity,
            title: planned.title,
            description: planned.description,
            node: planned.node,
            inspectionId: id,
            reportedById: ins.performedById,
            sourceKey: inspectionDefectKey(ins.equipmentId, planned.itemId),
          },
          select: { id: true },
        });
        await tx.outboxEvent.createMany({
          skipDuplicates: true,
          data: [{
            type: 'ReadinessSnapshotRequested', aggregateId: defect.id, aggregateType: 'EquipmentDefect',
            tenantId: ctx.tenantId,
            dedupeKey: `readiness.snapshot:${ctx.tenantId}:${ins.equipmentId}:DEFECT_CHANGED:${defect.id}:created`,
            payload: {
              triggerType: 'DEFECT_CHANGED', triggerId: `${defect.id}:created`,
              equipmentId: ins.equipmentId, triggerOccurredAt: now.toISOString(),
            } as Prisma.InputJsonValue,
          }],
        });
      }
    }
    // Осмотр — четверть балла готовности и условие запуска смены, поэтому его
    // завершение обязано пересчитать снимок. Раньше снимок заказывали только
    // наряды, дефекты и смены, и центр готовности показывал вчерашнюю оценку
    // до тех пор, пока не случится что-то ещё.
    // skipDuplicates: повторное завершение того же осмотра не должно ронять
    // транзакцию на уникальном dedupeKey — снимок по нему уже заказан.
    await tx.outboxEvent.createMany({
      skipDuplicates: true,
      data: [{
        type: 'ReadinessSnapshotRequested', aggregateId: id, aggregateType: 'Inspection',
        tenantId: ctx.tenantId,
        dedupeKey: `readiness.snapshot:${ctx.tenantId}:${ins.equipmentId}:INSPECTION_COMPLETED:${id}`,
        payload: {
          triggerType: 'INSPECTION_COMPLETED', triggerId: `${id}:completed`,
          equipmentId: ins.equipmentId, inspectionId: id, triggerOccurredAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      }],
    });
    return inspection;
  });
}
