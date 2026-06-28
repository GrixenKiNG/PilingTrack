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
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'reports.read_all');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const reports = await listRecentReportsForDashboard(user!);
    return NextResponse.json({ reports });
  },
  { domain: 'reports' }
);
