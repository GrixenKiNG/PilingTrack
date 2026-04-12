/**
 * GET /api/liveness
 *
 * Liveness probe — checks if the process is alive.
 * Used by orchestrators to detect deadlocks / crashes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLiveness } from '@/core/observability/health-checks';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const liveness = getLiveness();
  return NextResponse.json(liveness, { status: 200 });
}
