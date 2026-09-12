import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {withMutation} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {requireTenantId} from '@/lib/tenant';
import {acknowledgeBriefing, OperatorCommandError, submitKnowledgeTest} from '@/modules/operator-mobile';

export const runtime = 'nodejs';

const commandSchema = z.discriminatedUnion('command', [
  z.object({command: z.literal('acknowledge-briefing')}),
  z.object({
    command: z.literal('submit-knowledge'),
    attemptToken: z.string().min(1).max(4096),
    picks: z.array(z.object({
      questionId: z.string().min(1),
      picked: z.number().int().min(0).max(9),
    })).length(8),
  }),
]);

/**
 * Две команды помощника: прочитал инструкцию и прошёл проверку знаний.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ ОБЩИЙ С МАШИНИСТОМ. Маршрут смены пускает
 * только машиниста, и это правильно: там приём установки, осмотр и запись
 * выработки — всё, чего помощник делать не должен. Ослабить проверку роли
 * ради двух безобидных команд значило бы открыть заодно и остальные восемь.
 *
 * Обе команды исполняет тот же код, что и у машиниста, но с указанием, кому
 * они адресованы: инструкции и виды документов у них разные.
 */
export const POST = withMutation(
  async (request: NextRequest) => {
    const {user, error} = await requireAuth(request);
    if (error || !user) {
      return NextResponse.json({error: 'Войдите в систему'}, {status: 401});
    }
    if (user.role !== 'ASSISTANT') {
      return NextResponse.json({error: 'Команды доступны помощнику машиниста'}, {status: 403});
    }

    const parsed = commandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {error: 'Некорректная команда', details: parsed.error.issues},
        {status: 400},
      );
    }

    const actor = {
      tenantId: requireTenantId(user),
      operatorId: user.id,
      audience: 'ASSISTANT' as const,
    };

    try {
      const body = parsed.data;
      if (body.command === 'acknowledge-briefing') {
        return NextResponse.json({data: await acknowledgeBriefing(actor)});
      }
      return NextResponse.json({data: await submitKnowledgeTest({...actor, picks: body.picks, attemptToken: body.attemptToken})});
    } catch (commandError) {
      if (commandError instanceof OperatorCommandError) {
        return NextResponse.json(
          {error: commandError.message, details: commandError.details},
          {status: commandError.status},
        );
      }
      throw commandError;
    }
  },
  {domain: 'assistant.mobile'},
);
