import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJsonBody, withMutation } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { requireTenantId } from '@/lib/tenant';
import { assertCan } from '@/services/auth/authorization-service';
import { decidePilePassport } from '@/modules/reports/application/queries/pile-passport.service';

export const runtime = 'nodejs';

const decideSchema = z.object({
  acceptance: z.enum(['ACCEPTED', 'NEEDS_REDRIVE']),
  note: z.string().max(2000).optional(),
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
        { error: 'Некорректное решение', details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id } = await params;
    await decidePilePassport({
      tenantId,
      passportId: id,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      acceptance: parsed.data.acceptance,
      note: parsed.data.note,
    });
    return NextResponse.json({ ok: true });
  },
  { domain: 'piles' },
);
