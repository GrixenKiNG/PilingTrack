import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCrewForOperator } from '@/modules/crews';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const operatorId = request.nextUrl.searchParams.get('operatorId');
    const crew = await getCrewForOperator(user!, operatorId);
    if (crew) {
      await ensureTenantAccess(user!, crew.tenantId, 'Crew');
    }
    return NextResponse.json({ crew });
  },
  { domain: 'crews' }
);
