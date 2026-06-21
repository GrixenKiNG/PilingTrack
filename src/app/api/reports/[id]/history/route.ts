import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getReportHistory } from '@/services/reports/report-history-service';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'reports.read_all');
  const { id } = await params;
  const history = await getReportHistory(id);
  return NextResponse.json(history);
}, { domain: 'reports' });
