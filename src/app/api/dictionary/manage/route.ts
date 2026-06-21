import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
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
const createSchema = z.object({ type: typeEnum, name: z.string().min(1).max(100) });
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

  const filterParam = request.nextUrl.searchParams.get('filter');
  const filter: DictFilter = filterParam === 'archived' || filterParam === 'all' ? filterParam : 'active';

  const [{ pileGrades, drillingTypes, downtimeReasons }, usage] = await Promise.all([
    listDictionaries(filter),
    getDictionaryUsage(),
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
  const validated = createSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });
  const item = await createDictionaryItem(validated.data.type, validated.data.name);
  return NextResponse.json({ item });
}, { domain: 'dictionary' });

export const PATCH = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'dictionary.manage');
  const validated = patchSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });

  const { type, id, name, isActive, lengthMm } = validated.data;
  if (lengthMm !== undefined && type !== 'pileGrade') {
    return NextResponse.json({ error: 'lengthMm valid only for pileGrade' }, { status: 400 });
  }
  if (name !== undefined) await renameDictionaryItem(type, id, name);
  if (isActive === true) await restoreDictionaryItem(type, id);
  if (isActive === false) await archiveDictionaryItem(type, id);
  if (lengthMm !== undefined) await setPileGradeLength(id, lengthMm);
  return NextResponse.json({ success: true });
}, { domain: 'dictionary' });

export const DELETE = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'dictionary.manage');
  const validated = deleteSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });
  const result = await deleteDictionaryItem(validated.data.type, validated.data.id);
  return NextResponse.json(result);
}, { domain: 'dictionary' });
