import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { querySelfSafetyView } from '@/modules/safety';
import { withApi } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

/**
 * Свой допуск и свой журнал инструктажей. Доступно каждому — про себя.
 *
 * Права здесь нет намеренно: выборка сужена идентификатором ИЗ СЕССИИ, а не
 * из запроса, и чужого отдать не может. Параметра `userId` у маршрута нет и
 * появиться не должен — он и превратил бы личный раздел в чтение чужих
 * медосмотров.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    try {
      return NextResponse.json(await querySelfSafetyView({ tenantId, userId: actor.id }));
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
