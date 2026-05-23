import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getReportsModule() {
  return import('@/modules/reports');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'reports.read_all');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const userId = request.nextUrl.searchParams.get('userId');
    const { listReportsForReview } = await getReportsModule();
    const paginated = await listReportsForReview(user!, siteId, undefined, userId);
    return NextResponse.json({ reports: paginated.data, hasMore: paginated.hasMore, nextCursor: paginated.nextCursor });
  },
  { domain: 'reports', cache: true, cacheTTL: 10_000 }
);
