import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type { AnswerType, BlockType, ChecklistLevel, HammerKind } from '@/generated/postgres-client';

export interface TemplateItemInput {
  text: string; answerType: AnswerType; unit?: string | null; norm?: string | null;
  provenance?: string | null; photoRequired: boolean; required: boolean; order: number;
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
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const blockType = input.blockType ?? 'BASE';
  // Normalize matchers to the block kind: BASE keys on model, HAMMER on hammer kind.
  const appliesToModel = blockType === 'BASE' ? (input.appliesToModel?.trim() || null) : null;
  const appliesToHammerKind = blockType === 'HAMMER' ? (input.appliesToHammerKind ?? null) : null;
  return db.checklistTemplate.create({
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
  await deleteTemplate(id, ctx.tenantId);
  return createTemplate(input, ctx);
}

export async function deleteTemplate(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.checklistTemplate.findUnique({ where: { id }, select: { id: true, tenantId: true } });
  if (!existing || existing.tenantId !== tenantId) throw new ServiceError('Template not found', 404);
  return db.checklistTemplate.update({ where: { id }, data: { isActive: false } });
}
