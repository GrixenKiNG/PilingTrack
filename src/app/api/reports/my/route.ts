import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listReportsForUserScope } from '@/modules/reports';
import { withApi } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const reports = await listReportsForUserScope(user!, requestedUserId, pagination);
    const nextCursor = pagination.getNextCursor(reports);
    return NextResponse.json({ data: reports, nextCursor });
  },
  { domain: 'reports', cache: true, cacheTTL: 10_000 }
);
