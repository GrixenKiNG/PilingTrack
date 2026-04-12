import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withCsrf } from '@/lib/csrf-protection';
import { getEditableReport } from '@/modules/reports/application/queries/report-query.service';
import { ServiceError } from '@/services/service-error';


export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const { searchParams } = request.nextUrl;
    const requestedUserId = searchParams.get('userId');
    const siteId = searchParams.get('siteId');
    const date = searchParams.get('date');

    const report = await getEditableReport(user!, requestedUserId, siteId, date);
    return NextResponse.json({ report: report || null });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
