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
 *
 * The handler body is wrapped in try/catch (audit R60 #3): this route is the
 * Dockerfile HEALTHCHECK target, so an unhandled throw used to answer Next's
 * empty-body 500 — unreadable for deploy-prod.sh and monitoring. It now always
 * answers with the status/version/uptime contract.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getHealth } from '@/core/observability/health-checks';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  const statusMap: Record<string, number> = {
    ok: 200,
    degraded: 200,
    unhealthy: 503,
  };

  try {
    const health = await getHealth();

    return NextResponse.json(
      { status: health.status, version: health.version, uptime: health.uptime },
      { status: statusMap[health.status] || 200 },
    );
  } catch (error) {
    // Every dependency probe inside getHealth() catches its own failure and
    // reports it as degraded/unhealthy (health-checks.ts), so an exception
    // here means the health verdict itself could not be produced — the one
    // thing this route exists to deliver. "Unknown" must not be reported as
    // "ok", so the answer stays 503, but with a real JSON body: the code alone
    // is what makes the container unhealthy anyway (500 and 503 are the same
    // to `wget --spider`), while the body lets deploy-prod.sh and monitoring
    // tell an honest verdict from a crashed handler.
    logger.error('Health check failed', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        version: process.env.APP_VERSION || process.env.npm_package_version || 'unknown',
        uptime: process.uptime(),
      },
      { status: 503 },
    );
  }
}
