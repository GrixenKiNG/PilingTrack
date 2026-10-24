import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type { AnswerType, BlockType, ChecklistLevel, HammerKind } from '@/generated/postgres-client/client';

export interface TemplateItemInput {
  text: string; answerType: AnswerType; unit?: string | null; norm?: string | null;
  provenance?: string | null; photoRequired: boolean; required: boolean; order: number;
  /** Отрицательный ответ на пункт заводит дефект установки. */
  createsDefect?: boolean;
  defectSeverity?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL' | null;
}
export interface TemplateSectionInput { title: string; order: number; items: TemplateItemInput[] }
export interface TemplateInput {
  name: string; level: ChecklistLevel;
  blockType?: BlockType;            // default BASE
  appliesToModel?: string | null;
  appliesToHammerKind?: HammerKind | null;
  sections: TemplateSectionInput[];
}

export async function createTemplate(input: TemplateInput, ctx: { tenantId: string; createdById?: string | null }) {
  return createTemplateUsing(db, input, ctx);
}

type TemplateClient = Pick<typeof db, 'checklistTemplate'>;

async function createTemplateUsing(client: TemplateClient, input: TemplateInput, ctx: { tenantId: string; createdById?: string | null }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const blockType = input.blockType ?? 'BASE';
  // Normalize matchers to the block kind: BASE keys on model, HAMMER on hammer kind.
  const appliesToModel = blockType === 'BASE' ? (input.appliesToModel?.trim() || null) : null;
  const appliesToHammerKind = blockType === 'HAMMER' ? (input.appliesToHammerKind ?? null) : null;
  return client.checklistTemplate.create({
    data: {
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      level: input.level,
      blockType,
      appliesToModel,
      appliesToHammerKind,
      createdById: ctx.createdById ?? null,
      sections: {
        create: input.sections.map((s) => ({
          tenantId: ctx.tenantId,
          title: s.title.trim(),
          order: s.order,
          items: {
            create: s.items.map((i) => ({
              tenantId: ctx.tenantId,
              text: i.text.trim(),
              answerType: i.answerType,
              unit: i.unit?.trim() || null,
              norm: i.norm?.trim() || null,
              provenance: i.provenance?.trim() || null,
              photoRequired: i.photoRequired,
              required: i.required,
              createsDefect: i.createsDefect ?? false,
              // Уровень по умолчанию — NORMAL: заводить каждый ответ «нет»
              // критическим значило бы останавливать парк на мелочах.
              defectSeverity: i.createsDefect ? (i.defectSeverity ?? 'NORMAL') : null,
              order: i.order,
            })),
          },
        })),
      },
    },
  });
}

// Update = деактивировать старый + создать новый (проще и безопаснее, чем диффить вложенные пункты).
export async function updateTemplate(id: string, input: TemplateInput, ctx: { tenantId: string; createdById?: string | null }) {
  return db.$transaction(async (tx) => {
    await deactivateTemplateUsing(tx, id, ctx.tenantId);
    return createTemplateUsing(tx, input, ctx);
  });
}

export async function deleteTemplate(id: string, tenantId: string) {
  return deactivateTemplateUsing(db, id, tenantId);
}

/**
 * Вернуть отключённый шаблон в сборку осмотров.
 *
 * Отключённых шаблонов в базе много (замена через updateTemplate оставляет
 * прежнюю версию неактивной, плюс ручное снятие). Вернуть можно, пока нет
 * действующего шаблона с тем же ключом сборки — вид блока, уровень ТО, модель и
 * вид молота: два «Базовых» блока одной модели задвоили бы пункты осмотра.
 */
export async function activateTemplate(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.checklistTemplate.findUnique({
    where: { id },
    select: { id: true, tenantId: true, isActive: true, blockType: true, level: true, appliesToModel: true, appliesToHammerKind: true },
  });
  if (!existing || existing.tenantId !== tenantId) throw new ServiceError('Шаблон не найден — обновите список.', 404);
  if (existing.isActive) return existing;
  const clash = await db.checklistTemplate.findFirst({
    where: {
      tenantId, isActive: true, NOT: { id },
      blockType: existing.blockType, level: existing.level,
      appliesToModel: existing.appliesToModel, appliesToHammerKind: existing.appliesToHammerKind,
    },
    select: { id: true, name: true },
  });
  if (clash) {
    throw new ServiceError(`Для этой модели и вида ТО уже действует шаблон «${clash.name}». Сначала снимите его.`, 409);
  }
  return db.checklistTemplate.update({ where: { id }, data: { isActive: true } });
}

async function deactivateTemplateUsing(client: TemplateClient, id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await client.checklistTemplate.findUnique({ where: { id }, select: { id: true, tenantId: true } });
  if (!existing || existing.tenantId !== tenantId) throw new ServiceError('Шаблон не найден — обновите список.', 404);
  return client.checklistTemplate.update({ where: { id }, data: { isActive: false } });
}
