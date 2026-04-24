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

    const sessionUser = user!;
    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const sites = await getAccessibleSites(sessionUser, requestedUserId, pagination);
    const nextCursor = pagination.getNextCursor(sites);
    return NextResponse.json({ data: sites, sites, nextCursor });
  },
  { domain: 'sites', cache: true, cacheTTL: 30_000 }
);
