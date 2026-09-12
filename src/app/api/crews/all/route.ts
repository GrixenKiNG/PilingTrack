import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
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

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'crews.read');
    const crews: CrewSummary[] = await getCachedCrewsAll() as CrewSummary[];

    const tenantId = requireTenantId(user!);
    return NextResponse.json({ crews: crews.filter((crew) => crew.site?.tenantId === tenantId) });
  },
  { domain: 'crews', cache: true, cacheTTL: 15_000 }
);
