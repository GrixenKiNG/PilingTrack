/**
 * GET /api/ready
 *
 * Canonical infrastructure readiness endpoint.
 * `/api/readiness` is a deprecated compatibility alias because that namespace
 * is reserved for the technical-readiness business API.
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
