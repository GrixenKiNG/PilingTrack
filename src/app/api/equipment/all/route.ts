import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedEquipmentAll } from '@/lib/cached-queries';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { error } = await requireAuth(request);
    if (error) return error;

    const equipment = await getCachedEquipmentAll();
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment', cache: true, cacheTTL: 60_000 }
);
