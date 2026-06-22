import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getCrewsModule() {
  return import('@/modules/crews');
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const operatorId = request.nextUrl.searchParams.get('operatorId');
    const { getCrewForOperator } = await getCrewsModule();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const crew = await getCrewForOperator(user!, operatorId);
    if (crew) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      await ensureTenantAccess(user!, crew.tenantId, 'Crew');
    }
    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);
