/**
 * GET /api/ready
 *
 * Legacy readiness endpoint — now delegates to the new health check system.
 * Kept for backward compatibility with existing clients.
 */

import { NextRequest } from 'next/server';
import { getReadiness } from '@/core/observability/health-checks';
import { createJsonResponse, getRequestId } from '@/lib/request-context';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const readiness = await getReadiness();

  return createJsonResponse(
    {
      requestId,
      ready: readiness.status === 'ready',
      status: readiness.status,
      checks: readiness.checks,
    },
    { status: readiness.status === 'ready' ? 200 : 503 },
    requestId
  );
}
