/**
 * GET /api/reports/all
 *
 * List reports for review (ADMIN/DISPATCHER only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listReportsForReview } from '@/modules/reports';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'reports.read_all');
    const siteId = request.nextUrl.searchParams.get('siteId');
    const reports = await listReportsForReview(user!, siteId);
    return NextResponse.json({ reports });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
