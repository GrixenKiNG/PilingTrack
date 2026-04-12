/**
 * GET /api/health
 *
 * Overall health check with dependency checks.
 * Returns: { status: "ok" | "degraded" | "unhealthy", checks, uptime }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getHealth } from '@/core/observability/health-checks';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const health = await getHealth();

  const statusMap: Record<string, number> = {
    ok: 200,
    degraded: 200,
    unhealthy: 503,
  };

  return NextResponse.json(health, { status: statusMap[health.status] || 200 });
}
