import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { querySafetyClearanceOverview } from '@/modules/safety';
import { can } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

/**
 * Сводка допусков по работникам — рабочая выборка инженера ОТ перед сменой.
 *
 * Право то же, что у контроля документов и журнала инструктажей
 * (`users.documents.read_all`): это те же подтверждения тех же людей, только
 * сведённые в строку на человека. Третье право развело бы доступ к одним и тем
 * же фактам по трём матрицам.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    try {
      const overview = await querySafetyClearanceOverview({
        tenantId,
        // Право из прикладной матрицы: модулю её знать нельзя, решение здесь.
        // Замещённую роль учитывает сам `can` — администратор в режиме
        // механика чужих допусков не увидит, в этом и смысл режима.
        mayReadAllDocuments: can(actor, 'users.documents.read_all'),
      });
      return NextResponse.json(overview);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
