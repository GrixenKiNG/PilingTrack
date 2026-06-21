import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedAllDictionaries } from '@/lib/cached-queries';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { error } = await requireAuth(request);
    if (error) return error;

    const data = await getCachedAllDictionaries();
    return NextResponse.json(data);
  },
  { domain: 'dictionary', cache: true, cacheTTL: 120_000 }
);
