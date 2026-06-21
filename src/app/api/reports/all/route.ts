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

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.read_all');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const userId = request.nextUrl.searchParams.get('userId');
    const cursor = request.nextUrl.searchParams.get('cursor') || undefined;
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || 25);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;
    const { listReportsForReview } = await getReportsModule();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const paginated = await listReportsForReview(user!, siteId, { cursor, limit }, userId);
    return NextResponse.json({ reports: paginated.data, hasMore: paginated.hasMore, nextCursor: paginated.nextCursor });
  },
  { domain: 'reports', cache: true, cacheTTL: 10_000 }
);
