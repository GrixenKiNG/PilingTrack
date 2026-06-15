/**
 * GET /api/reports/recent
 *
 * Recent shift reports with evidence flags (photo / edited) for the
 * dispatcher dashboard journal. ADMIN/DISPATCHER only, read-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listRecentReportsForDashboard } from '@/modules/reports';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'reports.read_all');
    const reports = await listRecentReportsForDashboard(user!);
    return NextResponse.json({ reports });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
