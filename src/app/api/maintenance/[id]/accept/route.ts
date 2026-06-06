import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { acceptMaintenance } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

/** «Принять» — admin accepts/closes a finished work order. */
export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    if (user!.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Принять может только администратор' }, { status: 403 });
    }

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const { id } = await params;
    try {
      const record = await acceptMaintenance(id, { tenantId, userId: user!.id });
      return NextResponse.json({ record });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
