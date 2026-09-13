import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { signBriefingRecord } from '@/modules/safety';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

/**
 * Поставить свою отметку под записью журнала.
 *
 * Права из прикладной матрицы здесь нет намеренно: подписывают не «по
 * должности», а по участию. Кто именно вправе подписать эту запись — работник
 * или инструктор — решает сама команда, сверяя идентификатор из сессии с
 * записью. Право `users.documents.read_all` дало бы диспетчеру возможность
 * расписаться за машиниста, которого он в глаза не видел.
 */
export const POST = withMutation(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);
    const { id } = await context.params;

    try {
      const result = await signBriefingRecord({ tenantId, actorId: actor.id, recordId: id });
      return NextResponse.json({ data: result });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
