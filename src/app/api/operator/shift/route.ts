import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { withApi } from '@/core/api-wrapper';
import { getOperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';

export const runtime = 'nodejs';

/**
 * Состояние смены для экрана оператора.
 *
 * Отдаёт факты по бригаде ТОГО, КТО СПРАШИВАЕТ: чужого оператора сюда
 * подставить нельзя, идентификатор берётся из сессии, а не из параметров.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    if (!tenantId) {
      return NextResponse.json({ error: 'Организация не определена' }, { status: 400 });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const facts = await getOperatorShiftFacts(tenantId, user!.id);
    return NextResponse.json(facts);
  },
  { domain: 'readiness-shifts' }
);
