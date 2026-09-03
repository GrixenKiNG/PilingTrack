import {NextRequest, NextResponse} from 'next/server';
import {withApi} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {requireTenantId} from '@/lib/tenant';
import {queryAssistantState} from '@/modules/operator-mobile';

export const runtime = 'nodejs';

/**
 * Состояние рабочего места помощника машиниста.
 *
 * Смены здесь нет: её ведёт машинист. Помощнику отдаём то, что относится лично
 * к нему, — инструктаж по стропальным работам, проверку знаний, собственные
 * допуски со сроками и бригады, где он записан.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const {user, error} = await requireAuth(request);
    if (error || !user) {
      return NextResponse.json({error: 'Войдите в систему'}, {status: 401});
    }
    if (user.role !== 'ASSISTANT') {
      return NextResponse.json({error: 'Экран доступен помощнику машиниста'}, {status: 403});
    }

    const state = await queryAssistantState({
      tenantId: requireTenantId(user),
      assistantId: user.id,
      assistantName: user.name,
    });

    return NextResponse.json({data: state});
  },
  {domain: 'assistant.mobile'},
);
