import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { listEquipmentPermits, upsertEquipmentPermit } from '@/modules/safety';
import { can } from '@/services/auth/authorization-service';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

const permitSchema = z.object({
  userId: z.string().min(1),
  equipmentKind: z.enum(['PILE_DRIVER', 'DRILLING_RIG', 'VIBRO_HAMMER', 'HYBRID', 'OTHER']),
  equipmentModel: z.string().max(120).optional(),
  scope: z.enum(['OPERATION', 'ASSEMBLY', 'MAINTENANCE', 'RIGGING', 'SUPPORT']),
  status: z.enum(['ALLOWED', 'LIMITED', 'DENIED']),
  restriction: z.string().max(500).optional(),
  validUntil: z.string().datetime().nullable().optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * Матрица допусков работника к технике.
 *
 * СВОИ ДОПУСКИ ЧЕЛОВЕК ВИДИТ ВСЕГДА — как и свои документы. Чужие открывает
 * `users.documents.read_all`: это те же сведения о допуске тех же людей, и
 * третье право развело бы их по трём матрицам.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);
    const userId = request.nextUrl.searchParams.get('userId') ?? actor.id;

    try {
      return NextResponse.json({
        rows: await listEquipmentPermits({
          tenantId,
          userId,
          mayRead: userId === actor.id || can(actor, 'users.documents.read_all'),
        }),
      });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);

/**
 * Выдать или изменить допуск.
 *
 * Право строже, чем на чтение: `users.manage` — то же, которым заводят и
 * удаляют чужие документы работника. Кто и на чём вправе работать — кадровое
 * решение, а не наблюдение, и диспетчеру его принимать не за что.
 */
export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    const validated = permitSchema.safeParse(await request.json().catch(() => null));
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validated.error.flatten() },
        { status: 400 },
      );
    }
    const { userId, validUntil, ...rest } = validated.data;

    try {
      const saved = await upsertEquipmentPermit({
        tenantId,
        userId,
        actor: { id: actor.id, name: actor.name },
        mayManage: can(actor, 'users.manage'),
        payload: { ...rest, validUntil: validUntil ? new Date(validUntil) : null },
      });
      await recordAuditEvent({
        action: 'user.equipment_permit.saved',
        scope: 'users',
        actorId: actor.id,
        targetId: userId,
        tenantId,
        metadata: { permitId: saved.id, ...rest, validUntil: validUntil ?? null },
      });
      return NextResponse.json({ data: saved }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
