import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { addFuelEntry, listFuelLog, getFuelSummary } from '@/modules/equipment';
import { getCrewForOperator } from '@/modules/crews';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

/**
 * Оператор ведёт топливо только по своей машине — как и с моточасами: заправку
 * и остаток по указателю фиксирует тот, кто стоит у установки. Право само по
 * себе машину не сужает, поэтому проверяем закрепление за экипажем.
 */
async function assertOperatorOwnsEquipment(
  user: { id: string; role: string },
  equipmentId: string,
): Promise<void> {
  if (user.role !== 'OPERATOR') return;
  const crew = await getCrewForOperator(user, null);
  if (!crew || crew.equipmentId !== equipmentId) {
    throw new ServiceError('Установка не закреплена за вашим экипажем', 403);
  }
}

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z
  .object({
    litersAdded: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
    tankPercent: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(100)).optional().nullable(),
    recordedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
    source: z.enum(['MANUAL', 'TELEMETRY']).optional(),
    note: z.string().max(500).optional().nullable(),
  })
  .refine((d) => d.litersAdded != null || d.tankPercent != null, {
    message: 'Укажите долив в литрах или остаток в %',
  });

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'meter.record');

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      await assertOperatorOwnsEquipment(user!, id);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Период сводки: ?from&to (ISO), по умолчанию последние 30 дней.
    const toParam = request.nextUrl.searchParams.get('to');
    const fromParam = request.nextUrl.searchParams.get('from');
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid from/to' }, { status: 400 });
    }

    const [entries, summary] = await Promise.all([
      listFuelLog(id, tenantId),
      getFuelSummary(id, tenantId, from, to),
    ]);
    return NextResponse.json({ entries, summary });
  },
  { domain: 'equipment.maintenance' }
);

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'meter.record');

    const { id } = await params;
    const body = await readJsonBody(request);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      await assertOperatorOwnsEquipment(user!, id);
      const result = await addFuelEntry(id, parsed.data, {
        tenantId,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        recordedById: user!.id,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
