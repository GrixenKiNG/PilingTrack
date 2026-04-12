/**
 * System Status API — Partial failure visibility
 *
 * Returns detailed health status of all subsystems:
 * - Database connectivity + latency
 * - Redis connectivity + latency
 * - Outbox backlog + DLQ pending count
 * - Worker heartbeats
 * - Storage availability
 * - WebSocket connections
 * - System metrics (uptime, memory, etc.)
 *
 * Returns HTTP 503 when overall status is 'unhealthy'
 * Returns HTTP 200 when 'healthy' or 'degraded'
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { checkSystemStatus, getFreshStatus, getCurrentStatus } from '@/core/observability/health-tracker';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // Admin-only — health status reveals infrastructure details
  assertCan(user!, 'system.read');

  const searchParams = request.nextUrl.searchParams;
  const fresh = searchParams.get('fresh') === 'true';

  const cached = getCurrentStatus();
  const status = fresh ? await getFreshStatus() : (cached || await getFreshStatus());

  // Return 503 when unhealthy
  const httpStatus = status.status === 'unhealthy' ? 503 : 200;

  return NextResponse.json(status, { status: httpStatus });
}
