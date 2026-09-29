import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { deleteMeterReading } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; readingId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id, readingId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    // Снимок удаляемого показания читается ДО удаления (F-R34-13): строки
    // после `delete` уже нет, и восстановить, какую цифру она несла и кто её
    // внёс, нечем. Наработка и сроки ТО при этом пересчитываются — след
    // нужен и о том, что изменилось. Строго по тенанту, как и сама команда.
    const snapshot = await db.meterReading.findFirst({
      where: { id: readingId, equipmentId: id, tenantId },
      select: {
        engineHours: true,
        recordedAt: true,
        recordedById: true,
        equipment: { select: { name: true } },
      },
    });

    try {
      await deleteMeterReading(id, readingId, { tenantId });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    await recordAuditEvent({
      action: 'meter.reading.deleted',
      scope: 'equipment',
      actorId: actor.id,
      targetId: readingId,
      tenantId,
      metadata: snapshot
        ? {
            name: snapshot.equipment.name,
            before: {
              engineHours: snapshot.engineHours,
              recordedAt: snapshot.recordedAt,
              recordedById: snapshot.recordedById,
            },
          }
        : undefined,
    });

    return NextResponse.json({ success: true });
  },
  { domain: 'equipment.maintenance' }
);
