import {NextRequest, NextResponse} from 'next/server';
import {withApi} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {queryOperatorWorkplace} from '@/modules/operator-v3';

export const runtime = 'nodejs';

function contractError(code: 'UNAUTHENTICATED' | 'FORBIDDEN', message: string, status: 401 | 403) {
  return NextResponse.json({code, message}, {status});
}

export const GET = withApi(
  async (request: NextRequest) => {
    const {user, error} = await requireAuth(request);

    if (error || !user) {
      return contractError(
        'UNAUTHENTICATED',
        'Войдите в систему, чтобы открыть рабочее место оператора',
        401,
      );
    }

    if (user.role !== 'OPERATOR') {
      return contractError(
        'FORBIDDEN',
        'Рабочее место доступно только оператору',
        403,
      );
    }

    if (!user.tenantId) {
      return contractError(
        'FORBIDDEN',
        'Организация пользователя не определена',
        403,
      );
    }

    const workplace = await queryOperatorWorkplace({
      tenantId: user.tenantId,
      operatorId: user.id,
      operatorName: user.name,
    });

    return NextResponse.json({data: workplace});
  },
  {domain: 'operator-v3'},
);