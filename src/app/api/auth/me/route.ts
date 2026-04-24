import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveAccessibleUserId } from '@/services/auth/resource-access-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user: sessionUser, error } = await requireAuth(request);
    if (error) return error;

    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const userId = resolveAccessibleUserId(sessionUser!, requestedUserId, 'reports.read_cross_user');
    const db = await getDbClient();

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  },
  { domain: 'auth', cache: false }
);
