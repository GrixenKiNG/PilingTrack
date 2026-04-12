import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { assertCan } from '@/services/auth/authorization-service';
import { listAllSitesForAdmin } from '@/services/sites/site-admin-service';
import { getCachedSitesAll } from '@/lib/cached-queries';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'sites.read_all');
    const sites = await getCachedSitesAll();
    return NextResponse.json({ sites });
  },
  { domain: 'sites', cache: true, cacheTTL: 30_000 }
);
