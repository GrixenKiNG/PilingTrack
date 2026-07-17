/**
 * GET /api/health
 *
 * Public liveness/deploy-gate endpoint. Response is intentionally NARROW
 * (audit A-3 / July M5): heap MB, disk %, env names and raw check details
 * were fingerprinting material on an unauthenticated route. Consumers only
 * need the HTTP code (docker healthcheck, Caddy) plus status/version (deploy
 * runbook 008 verifies the deployed commit). Full diagnostic detail lives in
 * the admin-only /api/system/status; per-dependency ok/down for uptime
 * probes lives in /api/health/deep.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getHealth } from '@/core/observability/health-checks';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  const health = await getHealth();

  const statusMap: Record<string, number> = {
    ok: 200,
    degraded: 200,
    unhealthy: 503,
  };

  return NextResponse.json(
    { status: health.status, version: health.version, uptime: health.uptime },
    { status: statusMap[health.status] || 200 },
  );
}
