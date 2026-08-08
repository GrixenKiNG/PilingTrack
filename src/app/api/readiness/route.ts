/**
 * GET /api/readiness
 *
 * Deprecated compatibility alias for the infrastructure readiness probe.
 * New load balancers and orchestrators must use `/api/ready` so the
 * `/api/readiness/*` namespace remains exclusive to the business module.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadiness } from '@/core/observability/health-checks';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  const readiness = await getReadiness();
  const status = readiness.status === 'ready' ? 200 : 503;
  return NextResponse.json(readiness, {
    status,
    headers: {
      Deprecation: 'true',
      Sunset: 'Wed, 30 Sep 2026 21:00:00 GMT',
      Link: '</api/ready>; rel="successor-version"',
      Warning: '299 PilingTrack "Deprecated health probe; use /api/ready"',
    },
  });
}
