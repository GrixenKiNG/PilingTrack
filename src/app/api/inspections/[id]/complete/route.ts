import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { completeInspection } from '@/modules/inspections';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

const schema = z.object({ signedByName: z.string().trim().min(1).max(200) });

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'inspection.perform');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const { id } = await params;
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
    let inspection;
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      inspection = await completeInspection(id, { tenantId, signedByName: parsed.data.signedByName, performerId: user!.role === 'OPERATOR' ? user!.id : null });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Завершение осмотра — самый «допусковый» акт в системе: считается балл
    // состояния, закрывается наряд ТО, пишутся моточасы и заводятся дефекты, —
    // а следа в ленте не было вовсе (F-R72-FEED-INSPECTION). Название установки
    // и число заведённых дефектов команда не возвращает, поэтому читаются
    // отдельно — строго по тенанту и только после успешной команды.
    //
    // Осмотр к этому моменту уже завершён, поэтому сбой дообогащения не должен
    // превращать успех в 500 (F-R72-FEED-b): событие пишется с тем, что есть,
    // а неизвестное число дефектов остаётся null, а не нулём.
    let equipment: { name: string } | null = null;
    let defectCount: number | null = null;
    try {
      const [found, count] = await Promise.all([
        inspection
          ? db.equipment.findFirst({ where: { id: inspection.equipmentId, tenantId }, select: { name: true } })
          : null,
        db.equipmentDefect.count({ where: { tenantId, inspectionId: id } }),
      ]);
      equipment = found;
      defectCount = count;
    } catch (err) {
      logger.warn('inspection.completed.enrichment_failed', {
        inspectionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await recordAuditEvent({
      action: 'inspection.completed',
      scope: 'inspections',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: id,
      tenantId,
      metadata: {
        ...(equipment?.name ? { name: equipment.name } : {}),
        after: {
          level: inspection?.level ?? null,
          healthScore: inspection?.healthScore ?? null,
          defectCount,
        },
      },
    });

    return NextResponse.json({ inspection });
  },
  { domain: 'inspections' }
);
