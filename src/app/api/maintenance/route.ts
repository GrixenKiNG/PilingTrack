import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listAllMaintenance, type MaintenanceListFilter } from '@/modules/equipment';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const sp = request.nextUrl.searchParams;
    const filter: MaintenanceListFilter = {
      status: (sp.get('status') as MaintenanceListFilter['status']) ?? undefined,
      priority: (sp.get('priority') as MaintenanceListFilter['priority']) ?? undefined,
      assigneeId: sp.get('assigneeId') ?? undefined,
      type: (sp.get('type') as MaintenanceListFilter['type']) ?? undefined,
    };
    const records = await listAllMaintenance(tenantId, filter);
    return NextResponse.json({ records });
  },
  { domain: 'equipment.maintenance' }
);
