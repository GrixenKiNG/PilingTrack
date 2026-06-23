import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getAccessibleSites } from '@/modules/sites';
import { withApi } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const sessionUser = user!;
    const tenantId = sessionUser.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const sites = await getAccessibleSites(sessionUser, tenantId, requestedUserId, pagination);
    const nextCursor = pagination.getNextCursor(sites);
    return NextResponse.json({ data: sites, sites, nextCursor });
  },
  { domain: 'sites', cache: true, cacheTTL: 30_000 }
);
