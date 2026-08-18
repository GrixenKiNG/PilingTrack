import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listInspections, startInspection, startToInspection } from '@/modules/inspections';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

// Legacy start: explicit single template.
const legacyStartSchema = z.object({
  equipmentId: z.string().min(1),
  templateId: z.string().min(1),
  inspectionDate: z.coerce.date(),
  shift: z.string().max(20).optional().nullable(),
  engineHours: z.coerce.number().int().min(0).optional().nullable(),
});
// Block-composed start: pick a level, server assembles BASE+HAMMER+ROTARY.
const blockStartSchema = z.object({
  equipmentId: z.string().min(1),
  level: z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL']),
  inspectionDate: z.coerce.date(),
  shift: z.string().max(20).optional().nullable(),
  engineHours: z.coerce.number().int().min(0).optional().nullable(),
});

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'inspection.perform');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const equipmentId = request.nextUrl.searchParams.get('equipmentId') ?? undefined;
    const level = request.nextUrl.searchParams.get('level') ?? undefined;
    // Оператор видит только свои осмотры: право проводить осмотр не даёт
    // права смотреть чужие. Офис (админ, диспетчер, инженер ОТ) видит все.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const selfScopeId = user!.role === 'OPERATOR' ? user!.id : null;
    const inspections = await listInspections(tenantId, { equipmentId, level }, selfScopeId);
    return NextResponse.json({ inspections });
  },
  { domain: 'inspections' }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'inspection.perform');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const body = await readJsonBody(request);
    const isBlockStart = body && typeof body === 'object' && 'level' in body && !('templateId' in body);

    const parsed = isBlockStart ? blockStartSchema.safeParse(body) : legacyStartSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }
    try {
      const inspection = isBlockStart
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        ? await startToInspection(parsed.data as z.infer<typeof blockStartSchema>, { tenantId, userId: user!.id })
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        : await startInspection(parsed.data as z.infer<typeof legacyStartSchema>, { tenantId, userId: user!.id });
      return NextResponse.json({ inspection }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);
