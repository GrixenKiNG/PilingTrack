import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { deleteFuelEntry } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id, entryId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    // Снимок удаляемой записи читается ДО удаления (F-R39-3): строки после
    // `delete` уже нет, а спорную заправку разбирают по литражу и дате,
    // которых больше нигде не останется. Строго по тенанту, как и команда.
    const snapshot = await db.fuelLog.findFirst({
      where: { id: entryId, equipmentId: id, tenantId },
      select: {
        litersAdded: true,
        recordedAt: true,
        source: true,
        equipment: { select: { name: true } },
      },
    });

    try {
      await deleteFuelEntry(id, entryId, { tenantId });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Best-effort (F-R39-3): запись о топливе уже удалена безвозвратно — сбой
    // записи следа не должен превращать успешное удаление в 500, иначе админ
    // повторит запрос и получит 404 по уже удалённой строке.
    try {
      await recordAuditEvent({
        action: 'equipment.fuel.deleted',
        scope: 'equipment',
        actorId: actor.id,
        targetId: entryId,
        tenantId,
        metadata: snapshot
          ? {
              name: snapshot.equipment.name,
              before: {
                litersAdded: snapshot.litersAdded,
                recordedAt: snapshot.recordedAt,
                source: snapshot.source,
              },
            }
          : undefined,
      });
    } catch (err) {
      logger.error('Fuel entry delete: audit write failed', err, { entryId });
    }

    return NextResponse.json({ success: true });
  },
  { domain: 'equipment.maintenance' }
);
