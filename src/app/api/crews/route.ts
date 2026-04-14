import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createCrew, getAccessibleCrews } from '@/modules/crews';
import { createCrewSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.read');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const crews = await getAccessibleCrews(siteId || undefined, pagination);
    const nextCursor = pagination.getNextCursor(crews);
    return NextResponse.json({ data: crews, nextCursor });
  },
  { domain: 'crews', cache: true, cacheTTL: 15_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.manage');
    const body = await request.json();

    const validation = createCrewSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const crew = await createCrew({
      name: validation.data.name?.trim() || 'Unnamed Crew',
      operatorId: validation.data.operatorId,
      equipmentId: validation.data.equipmentId,
      siteId: validation.data.siteId,
      userId: user!.id,
    });

    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);
