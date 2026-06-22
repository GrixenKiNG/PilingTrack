import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createCrewSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';
import { invalidateCrewsCache } from './cache';


export const runtime = 'nodejs';

async function getCrewsModule() {
  return import('@/modules/crews');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'crews.read');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const siteId = request.nextUrl.searchParams.get('siteId');
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const { getAccessibleCrews } = await getCrewsModule();
    const crews = await getAccessibleCrews(tenantId, siteId || undefined, pagination);
    const nextCursor = pagination.getNextCursor(crews);
    return NextResponse.json({ data: crews, nextCursor });
  },
  { domain: 'crews', cache: true, cacheTTL: 15_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'crews.manage');
    const body = await request.json();

    const validation = createCrewSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const { createCrew } = await getCrewsModule();
    const crew = await createCrew({
      name: validation.data.name?.trim() || 'Unnamed Crew',
      operatorId: validation.data.operatorId,
      equipmentId: validation.data.equipmentId,
      siteId: validation.data.siteId,
      assistantNames: validation.data.assistantNames || [],
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      userId: user!.id,
    });

    invalidateCrewsCache();

    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);
