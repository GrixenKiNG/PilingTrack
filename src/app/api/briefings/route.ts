import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { conductBriefing } from '@/modules/safety';
import { can } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

const conductSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['INDUCTION', 'PRIMARY', 'REPEAT', 'UNSCHEDULED', 'TARGETED']),
  documentCode: z.string().min(1),
  documentTitle: z.string().min(1),
  documentVersion: z.string().min(1),
  reason: z.string().max(500).default(''),
  recordedAt: z.string().datetime().optional(),
});

/**
 * Провести инструктаж — запись в журнал от имени инструктора.
 *
 * Право то же, что у чтения журнала (`users.documents.read_all`): круг тех,
 * кто ведёт инструктажи, и тех, кто их читает, в этой организации совпадает —
 * админ, диспетчер, инженер ОТ. Отдельное право развело бы по двум матрицам
 * одно и то же занятие.
 */
export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    const validated = conductSchema.safeParse(await request.json().catch(() => null));
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validated.error.flatten() },
        { status: 400 },
      );
    }
    const data = validated.data;

    try {
      const created = await conductBriefing({
        tenantId,
        actor: { id: actor.id, name: actor.name },
        mayManageBriefings: can(actor, 'users.documents.read_all'),
        payload: {
          ...data,
          recordedAt: data.recordedAt ? new Date(data.recordedAt) : undefined,
        },
      });
      return NextResponse.json({ data: created }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
