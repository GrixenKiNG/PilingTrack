import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/services/service-error';
import { resolveAccessibleUserId } from '@/services/auth/resource-access-service';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user: sessionUser, error } = await requireAuth(request);
    if (error) return error;

    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const userId = resolveAccessibleUserId(sessionUser!, requestedUserId, 'reports.read_cross_user');

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
