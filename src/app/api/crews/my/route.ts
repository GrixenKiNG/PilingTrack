import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { getCrewForOperator } from '@/modules/crews';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';
import { db } from '@/lib/db';


export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const operatorId = request.nextUrl.searchParams.get('operatorId');
    const crew = await getCrewForOperator(user!, operatorId);
    if (crew) {
      await ensureTenantAccess(user!, crew.tenantId, 'Crew');
    }
    return NextResponse.json({ crew });
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return NextResponse.json({ error: caughtError.message }, { status: caughtError.status });
    }

    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
