import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { invalidateDictionaries } from '@/lib/cached-queries';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createDictionaryItem, deleteDictionaryItem, archiveDictionaryItem,
  restoreDictionaryItem, renameDictionaryItem, setPileGradeLength,
  listDictionaries, getDictionaryUsage,
  type DictFilter, type UsageMap,
} from '@/services/dictionaries/dictionary-service';
import { withApi, withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

const typeEnum = z.enum(['pileGrade', 'drillingType', 'downtimeReason']);
const createSchema = z.object({
  type: typeEnum,
  name: z.string().min(1).max(100),
  code: z.string().max(100).optional(),
  lengthMm: z.number().int().min(0).max(1_000_000).nullable().optional(),
  sectionOrDiameter: z.string().max(100).nullable().optional(),
  notes: z.string().max(500).optional(),
}).superRefine((value, context) => {
  if (value.type === 'pileGrade' && (!value.lengthMm || value.lengthMm <= 0)) {
    context.addIssue({
      code: 'custom',
      path: ['lengthMm'],
      message: 'Для марки сваи требуется положительная длина в миллиметрах',
    });
  }
});
const deleteSchema = z.object({ type: typeEnum, id: z.string().min(1) });
const patchSchema = z.object({
  type: typeEnum, id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  // Pile length in millimetres; null clears it. Only valid for pileGrade.
  lengthMm: z.number().int().min(0).max(1_000_000).nullable().optional(),
}).refine(
  (v) => v.name !== undefined || v.isActive !== undefined || v.lengthMm !== undefined,
  { message: 'name, isActive or lengthMm required' },
);

function withUsage<T extends { id: string }>(items: T[], usage: UsageMap) {
  return items.map((it) => ({ ...it, reportCount: usage[it.id]?.reportCount ?? 0, planCount: usage[it.id]?.planCount ?? 0 }));
}

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'dictionary.manage');
  if (!user?.tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
  const tenantId = user.tenantId;

  const filterParam = request.nextUrl.searchParams.get('filter');
  const filter: DictFilter = filterParam === 'archived' || filterParam === 'all' ? filterParam : 'active';

  const [{ pileGrades, drillingTypes, downtimeReasons }, usage] = await Promise.all([
    listDictionaries(tenantId, filter),
    getDictionaryUsage(tenantId),
  ]);

  return NextResponse.json({
    pileGrades: withUsage(pileGrades, usage.pileGrade),
    drillingTypes: withUsage(drillingTypes, usage.drillingType),
    downtimeReasons: withUsage(downtimeReasons, usage.downtimeReason),
  });
}, { domain: 'dictionary' });

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'dictionary.manage');
  if (!user?.tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
  const context = { tenantId: user.tenantId, actorId: user.id };
  const validated = createSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });
  const { type, ...input } = validated.data;
  const item = await createDictionaryItem(context, type, input);
  await invalidateDictionaries(context.tenantId);
  return NextResponse.json({ item });
}, { domain: 'dictionary' });

export const PATCH = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'dictionary.manage');
  if (!user?.tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
  const context = { tenantId: user.tenantId, actorId: user.id };
  const validated = patchSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });

  const { type, id, name, isActive, lengthMm } = validated.data;
  if (lengthMm !== undefined && type !== 'pileGrade') {
    return NextResponse.json({ error: 'lengthMm valid only for pileGrade' }, { status: 400 });
  }
  if (name !== undefined) await renameDictionaryItem(context, type, id, name);
  if (isActive === true) await restoreDictionaryItem(context, type, id);
  if (isActive === false) await archiveDictionaryItem(context, type, id);
  if (lengthMm !== undefined) await setPileGradeLength(context, id, lengthMm);
  await invalidateDictionaries(context.tenantId);
  return NextResponse.json({ success: true });
}, { domain: 'dictionary' });

export const DELETE = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'dictionary.manage');
  if (!user?.tenantId) return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
  const context = { tenantId: user.tenantId, actorId: user.id };
  const validated = deleteSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });
  const result = await deleteDictionaryItem(context, validated.data.type, validated.data.id);
  await invalidateDictionaries(context.tenantId);
  return NextResponse.json(result);
}, { domain: 'dictionary' });
