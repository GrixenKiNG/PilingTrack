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

    // Redis cache with 5 min TTL
    const cacheKey = `analytics:sites:${user!.id}`;
    const analytics = await cache.getOrSet(
      cacheKey,
      () => getSiteAnalytics(),
      { ttl: 300 }
    );

    return NextResponse.json({ analytics });
  },
  { domain: 'analytics', cache: true, cacheTTL: 60_000 }
);
