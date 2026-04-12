/**
 * GET /api/reports/my
 *
 * List reports for current user scope.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listReportsForUserScope } from '@/modules/reports';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const reports = await listReportsForUserScope(user!, requestedUserId);
    return NextResponse.json({ reports });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
