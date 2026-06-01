import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listAssignableUsers } from '@/modules/users';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const users = await listAssignableUsers(tenantId);
    return NextResponse.json({ users });
  },
  { domain: 'equipment.maintenance' }
);
