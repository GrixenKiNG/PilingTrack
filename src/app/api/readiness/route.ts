/**
 * GET /api/readiness
 *
 * Readiness probe — checks if the app is ready to receive traffic.
 * Used by load balancers / orchestrators.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadiness } from '@/core/observability/health-checks';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const readiness = await getReadiness();
  const status = readiness.status === 'ready' ? 200 : 503;
  return NextResponse.json(readiness, { status });
}
