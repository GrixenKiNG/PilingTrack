import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const POST = withMutation(async (req: NextRequest) => {
  const { error } = await requireAuth(req);
  if (error) return error;

  return NextResponse.json(
    { success: false, error: 'Recognition feature is not available in production' },
    { status: 501 }
  );
}, { domain: 'recognize' });
