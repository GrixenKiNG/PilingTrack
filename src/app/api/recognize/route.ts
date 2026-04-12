import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { error } = await requireAuth(req);
  if (error) return error;

  // Return 501 Not Implemented - recognize feature is optional/dev-only
  return NextResponse.json(
    { success: false, error: 'Recognition feature is not available in production' },
    { status: 501 }
  );
}
