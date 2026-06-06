import { db } from '@/lib/db';
import type { Prisma } from '@/generated/postgres-client/client';
import { ServiceError } from '@/services/service-error';
import { computeHealthScore, findMissing, type SnapItem, type AnswerLike } from '../../domain/inspection-logic';
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
        provenance: i.provenance, required: i.required, photoRequired: i.photoRequired, order: i.order,
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
  const record = await db.maintenanceRecord.create({
    data: {
      tenantId: ctx.tenantId, equipmentId: eq.id, type: input.level,
      status: 'IN_PROGRESS', title: LEVEL_TITLE[input.level],
      createdById: ctx.userId, startedAt: new Date(),
    },
  });
  return db.inspection.create({
    data: {
      tenantId: ctx.tenantId, equipmentId: eq.id, templateId: baseTemplateId,
      maintenanceRecordId: record.id, level: input.level, performedById: ctx.userId,
      inspectionDate: toDate(input.inspectionDate),
      shift: input.shift ?? null, engineHours: input.engineHours ?? null,
      status: 'DRAFT', templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
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

export async function saveAnswers(id: string, answers: AnswerInput[], ctx: { tenantId: string }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true } });
  if (!ins || ins.tenantId !== ctx.tenantId) throw new ServiceError('Inspection not found', 404);
  if (ins.status === 'COMPLETED') throw new ServiceError('Inspection already completed', 409);
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

export async function completeInspection(id: string, ctx: { tenantId: string; signedByName: string }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({ where: { id }, include: { answers: true } });
  if (!ins || ins.tenantId !== ctx.tenantId) throw new ServiceError('Inspection not found', 404);

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
  return db.inspection.update({
    where: { id },
    data: { status: 'COMPLETED', healthScore, signedByName: ctx.signedByName, signedAt: new Date() },
  });
}
