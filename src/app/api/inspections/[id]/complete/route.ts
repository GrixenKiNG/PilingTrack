import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { completeInspectionWithOutcome } from '@/modules/inspections';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

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
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      const actor = user!;
      // След «Осмотр завершён» пишет сама команда, в одной транзакции с завершением;
      // повтор завершения (обрыв связи, двойное нажатие) второго события не создаёт.
      const { inspection } = await completeInspectionWithOutcome(id, {
        tenantId,
        signedByName: parsed.data.signedByName,
        performerId: actor.role === 'OPERATOR' ? actor.id : null,
        actorId: actor.id,
      });
      return NextResponse.json({ inspection });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);
