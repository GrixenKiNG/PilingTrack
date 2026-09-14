import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { deleteEquipmentPermit } from '@/modules/safety';
import { can } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

/** Убрать строку матрицы. Право то же, что у выдачи: `users.manage`. */
export const DELETE = withMutation(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);
    const { id } = await context.params;

    try {
      await deleteEquipmentPermit({
        tenantId,
        permitId: id,
        mayManage: can(actor, 'users.manage'),
      });
      return NextResponse.json({ data: { id } });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
