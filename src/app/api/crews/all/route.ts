import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listCrewSummaries } from '@/modules/crews';
import { getCachedCrewsAll } from '@/lib/cached-queries';
import { withApi } from '@/core/api-wrapper';

interface CrewSummary {
  id: string;
  name: string;
  site?: { tenantId?: string | null } | null;
  [key: string]: unknown;
}

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'crews.legacy_manage');
    let crews: CrewSummary[] = await getCachedCrewsAll() as CrewSummary[];

    // Tenant isolation: non-ADMIN/DISPATCHER users see only their tenant's crews
    if (user!.tenantId && user!.role !== 'ADMIN' && user!.role !== 'DISPATCHER') {
      crews = crews.filter((c) => c.site?.tenantId === user!.tenantId);
    }

    return NextResponse.json({ crews });
  },
  { domain: 'crews', cache: true, cacheTTL: 15_000 }
);
