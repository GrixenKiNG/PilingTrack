import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { listReportsForReview } from '@/modules/reports';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'reports.read_all');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const paginated = await listReportsForReview(user!, siteId);
    return NextResponse.json({ reports: paginated.data, hasMore: paginated.hasMore, nextCursor: paginated.nextCursor });
  },
  { domain: 'reports', cache: true, cacheTTL: 10_000 }
);
