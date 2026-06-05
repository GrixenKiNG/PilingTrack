import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { computeHealthScore, findMissing, type SnapItem, type AnswerLike } from '../../domain/inspection-logic';

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

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
