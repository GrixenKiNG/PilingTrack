import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan, assertRole } from '@/services/auth/authorization-service';
import { acceptMaintenance } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

/** «Принять» — admin accepts/closes a finished work order. */
export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');
    // Через assertRole, а не по user.role: проверка настоящей роли пропускала
    // администратора в режиме «Действую как механик» — то есть ровно того, от
    // кого приёмка и отделяет исполнителя работ.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertRole(user!, 'ADMIN');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);
    const { id } = await params;
    try {
      const record = await acceptMaintenance(id, { tenantId, userId: actor.id });
      // Best-effort (F-R34-12): наряд уже принят — сбой записи следа не должен
      // превращать успешную приёмку в 500.
      try {
        await recordAuditEvent({
          action: 'maintenance.accepted',
          scope: 'equipment',
          actorId: actor.id,
          targetId: id,
          tenantId,
          metadata: { name: record.title },
        });
      } catch (err) {
        logger.error('Maintenance accept: audit write failed', err, { recordId: id });
      }
      return NextResponse.json({ record });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
