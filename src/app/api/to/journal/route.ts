import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listToJournal } from '@/modules/inspections';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

/** Unified ТО journal for one machine (ЕО/ТО + ремонт/неисправность). */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const equipmentId = request.nextUrl.searchParams.get('equipmentId');
    if (!equipmentId) return NextResponse.json({ error: 'equipmentId required' }, { status: 400 });
    const records = await listToJournal(tenantId, equipmentId);
    return NextResponse.json({ records });
  },
  { domain: 'inspections' }
);
