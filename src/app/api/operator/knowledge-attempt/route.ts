import {NextRequest, NextResponse} from 'next/server';
import {withApi} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {createKnowledgeAttempt} from '@/modules/operator-mobile/application/knowledge-attempt';
export const runtime = 'nodejs';
export const GET = withApi(async (request: NextRequest) => {
  const {user, error} = await requireAuth(request);
  if (error || !user) return error ?? NextResponse.json({error: 'Войдите в систему'}, {status: 401});
  if (!user.tenantId || (user.role !== 'OPERATOR' && user.role !== 'ASSISTANT')) {
    return NextResponse.json({error: 'Проверка доступна машинисту и помощнику'}, {status: 403});
  }
  return NextResponse.json({data: await createKnowledgeAttempt({tenantId: user.tenantId,
    operatorId: user.id, audience: user.role})}, {headers: {'Cache-Control': 'no-store'}});
}, {domain: 'operator.knowledge'});
