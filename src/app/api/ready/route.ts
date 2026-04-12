/**
 * GET /api/ready
 *
 * Legacy readiness endpoint — now delegates to the new health check system.
 * Kept for backward compatibility with existing clients.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadiness } from '@/core/observability/health-checks';
import { getRequestId } from '@/lib/request-context';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const readiness = await getReadiness();

  return NextResponse.json(
    {
      requestId,
      ready: readiness.status === 'ready',
      status: readiness.status,
      checks: readiness.checks,
    },
    { status: readiness.status === 'ready' ? 200 : 503 }
  );
}
