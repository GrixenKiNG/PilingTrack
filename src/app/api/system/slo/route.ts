/**
 * GET /api/system/slo
 *
 * Returns current SLO status:
 * - API availability (target: 99.9%)
 * - Sync success rate (target: 99%)
 * - Event delivery latency (target: < 2s)
 * - Outbox backlog
 * - DLQ pending count
 * - Circuit breaker health
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getSLOHealth, checkAllBurnRateAlerts } from '@/core/observability/slo-enforcement';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  assertCan(user!, 'system.read');

  const sloHealth = getSLOHealth();
  const alerts = checkAllBurnRateAlerts();

  return NextResponse.json({ slo: sloHealth, alerts });
}, { domain: 'system' });
