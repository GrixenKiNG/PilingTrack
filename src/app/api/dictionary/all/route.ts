import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getCachedAllDictionaries } from '@/lib/cached-queries';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    if (!user?.tenantId) {
      return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
    }
    const data = await getCachedAllDictionaries(user.tenantId);
    return NextResponse.json(data);
  },
  { domain: 'dictionary', cache: false }
);
