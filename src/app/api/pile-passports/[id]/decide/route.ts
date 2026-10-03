import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, withMutation } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { requireTenantId } from '@/lib/tenant';
import { db } from '@/lib/db';
import { assertCan } from '@/services/auth/authorization-service';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { decidePilePassport } from '@/modules/reports/application/queries/pile-passport.service';

export const runtime = 'nodejs';

const decideSchema = z.object({
  acceptance: z.enum(['ACCEPTED', 'NEEDS_REDRIVE']),
  note: z.string().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.acceptance === 'NEEDS_REDRIVE' && !value.note?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['note'], message: 'Укажите, почему свая идёт на добивку' });
  }
});

/** Решение мастера по свае: принять либо отправить на добивку. */
export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'piles.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);

    const parsed = decideSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.find((issue) => issue.code === 'custom')?.message ?? 'Некорректное решение', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id } = await params;

    // Прежнее решение читается ДО перезаписи: acceptance/acceptedById/
    // acceptedAt/acceptanceNote — те же колонки, и второе решение мастера
    // стирает первое (F-R34-16). Без снимка «before» в журнале не остаётся,
    // кто и когда принял сваю, которую потом отправили на добивку.
    const previous = await db.pilePassport.findFirst({
      where: { id, tenantId },
      select: {
        pileNumber: true,
        acceptance: true,
        acceptedById: true,
        acceptedAt: true,
        acceptanceNote: true,
      },
    });

    await decidePilePassport({
      tenantId,
      passportId: id,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      acceptance: parsed.data.acceptance,
      note: parsed.data.note,
    });

    await recordAuditEvent({
      action: 'pile.passport.decided',
      scope: 'reports',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: id,
      tenantId,
      metadata: {
        pileNumber: previous?.pileNumber ?? null,
        before: previous
          ? {
              acceptance: previous.acceptance,
              acceptedById: previous.acceptedById,
              acceptedAt: previous.acceptedAt,
              acceptanceNote: previous.acceptanceNote,
            }
          : null,
        after: {
          acceptance: parsed.data.acceptance,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
          acceptedById: user!.id,
          // Тем же правилом, что и команда: пустая причина — отсутствие причины.
          acceptanceNote: parsed.data.note?.trim() || null,
        },
      },
    });
    return NextResponse.json({ ok: true });
  },
  { domain: 'piles' },
);
