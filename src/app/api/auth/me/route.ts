import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  ensureTenantAccess,
  resolveAccessibleUserId,
} from '@/services/auth/resource-access-service';
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

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = sessionUser!;

    const requestedUserId = request.nextUrl.searchParams.get('userId');
    const userId = resolveAccessibleUserId(actor, requestedUserId, 'reports.read_cross_user');
    const db = await getDbClient();

    const row = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, isActive: true, tenantId: true },
    });

    if (!row) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Второй слой под RLS. Политика `tenant_isolation_user` уже отсекает чужую
    // строку в базе, но этот запрос идёт по одному первичному ключу — без
    // прикладной проверки под потерянным `app.current_tenant` не осталось бы
    // ничего. Чужой тенант отдаёт такой же 404, как отсутствующая строка.
    const { tenantId, ...user } = row;
    await ensureTenantAccess(actor, tenantId, 'User');

    return NextResponse.json({ user });
  },
  { domain: 'auth', cache: false }
);
