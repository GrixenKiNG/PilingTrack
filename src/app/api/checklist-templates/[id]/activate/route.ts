import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { activateTemplate } from '@/modules/inspections';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { recordAuditEvent } from '@/modules/audit';

export const runtime = 'nodejs';

/** Вернуть отключённый шаблон в сборку осмотров (пара к DELETE — деактивации). */
export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const { id } = await params;
    try {
      await activateTemplate(id, tenantId);
      await recordAuditEvent({
        action: 'inspection.template.activated', scope: 'inspections', actorId: user?.id,
        targetId: id, tenantId,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);
