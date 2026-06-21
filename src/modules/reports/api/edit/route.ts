/**
 * GET /api/reports/edit
 *
 * Get editable report by userId + siteId + date.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getEditableReport } from '@/modules/reports';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const { searchParams } = request.nextUrl;
    const requestedUserId = searchParams.get('userId');
    const siteId = searchParams.get('siteId');
    const date = searchParams.get('date');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const report = await getEditableReport(user!, requestedUserId, siteId, date);
    return NextResponse.json({ report: report || null });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
