import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getSiteAnalytics } from '@/modules/analytics';
import { cache } from '@/lib/redis-cache';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'analytics.read');

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const dateFrom = request.nextUrl.searchParams.get('dateFrom') ?? undefined;
    const dateTo = request.nextUrl.searchParams.get('dateTo') ?? undefined;
    const siteId = request.nextUrl.searchParams.get('siteId') ?? undefined;

    // Redis cache with 5 min TTL. Key MUST include the tenant + the slice
    // (period/site) so one cache entry never serves another tenant's data.
    const cacheKey = `analytics:sites:v3:${tenantId}:${dateFrom ?? 'all'}:${dateTo ?? 'all'}:${siteId ?? 'all'}`;
    const analytics = await cache.getOrSet(
      cacheKey,
      () => getSiteAnalytics({ tenantId, dateFrom, dateTo, siteId }),
      { ttl: 300 }
    );

    return NextResponse.json({ analytics });
  },
  { domain: 'analytics', cache: true, cacheTTL: 60_000 }
);
