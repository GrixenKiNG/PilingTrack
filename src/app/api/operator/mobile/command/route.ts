import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {withMutation} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {
  acceptEquipment, acknowledgeBriefing, closeShift, finishWork, logProduction,
  OperatorCommandError, correctProduction, reportIncident, submitChecklist, submitKnowledgeTest,
} from '@/modules/operator-mobile';
import {INCIDENT_CATEGORIES, INCIDENT_SIGNS} from '@/modules/operator-mobile/contracts';
import {getWeatherAt} from '@/services/weather/weather-client';

export const runtime = 'nodejs';

const answerSchema = z.object({
  itemId: z.string().min(1),
  // «Не применимо» здесь намеренно не принимается. Пункты, не относящиеся к
  // этой машине или к этой погоде, до оператора не доходят вовсе — их убирает
  // подбор состава. Оставить NA значило бы дать способ пропустить осмотр
  // мачты, объявив её неприменимой.
  answer: z.enum(['OK', 'REMARK', 'FAULT']),
  note: z.string().max(2000).optional(),
  measures: z.record(z.string(), z.number().finite()).optional(),
  mediaIds: z.array(z.string()).max(10).optional(),
});

const commandSchema = z.discriminatedUnion('command', [
  z.object({command: z.literal('acknowledge-briefing')}),
  z.object({
    command: z.literal('submit-knowledge'),
    picks: z.array(z.object({
      questionId: z.string().min(1),
      picked: z.number().int().min(0).max(9),
    })).min(1).max(20),
  }),
  z.object({
    command: z.literal('accept-equipment'),
    clientCommandId: z.string().min(8).max(64),
    equipmentId: z.string().min(1),
    shiftType: z.enum(['DAY', 'NIGHT']),
  }),
  z.object({
    command: z.literal('submit-checklist'),
    clientCommandId: z.string().min(8).max(64),
    shiftId: z.string().min(1),
    equipmentId: z.string().min(1),
    stage: z.enum([
      'PRESHIFT_INSPECTION', 'EO_BEFORE', 'SITE_READY', 'TB_PILING', 'TB_DRILLING', 'EO_AFTER',
    ]),
    answers: z.array(answerSchema).min(1).max(60),
  }),
  z.object({
    command: z.literal('log-production'),
    clientCommandId: z.string().min(8).max(64),
    shiftId: z.string().min(1),
    entry: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('PILES'),
        pileGradeId: z.string().min(1),
        count: z.number().int().min(1).max(500),
        comment: z.string().max(500).optional(),
      }),
      z.object({
        kind: z.literal('DRILLING'),
        typeId: z.string().min(1),
        count: z.number().int().min(1).max(500),
        // Как в отчёте за смену: метры на одну скважину, объём считает сервер.
        metersPerUnit: z.number().min(0.1).max(200),
      }),
      z.object({
        kind: z.literal('DOWNTIME'),
        reasonId: z.string().min(1),
        // Простой измеряется в часах во всём приложении. Максимум в 24
        // отсекает опечатку «ввёл минуты».
        hours: z.number().min(0.1).max(24),
        comment: z.string().max(500).optional(),
      }),
    ]),
  }),
  z.object({
    command: z.literal('correct-production'),
    clientCommandId: z.string().min(8).max(64),
    shiftId: z.string().min(1),
    kind: z.enum(['PILES', 'DRILLING', 'DOWNTIME']),
    entryId: z.string().min(1),
    // Сколько было на самом деле. Ноль допустим: запись могли завести целиком
    // по ошибке, и «на самом деле нисколько» — законный ответ.
    actual: z.number().min(0).max(500),
    reason: z.string().min(3).max(500),
  }),
  z.object({
    command: z.literal('report-incident'),
    clientCommandId: z.string().min(8).max(64),
    shiftId: z.string().min(1),
    category: z.enum(INCIDENT_CATEGORIES as [string, ...string[]]),
    // Хотя бы один признак: по ним правило решает, насколько это опасно.
    // Пустой список означал бы происшествие без оценки — запись, по которой
    // нельзя понять, надо ли бежать.
    signs: z.array(z.enum(INCIDENT_SIGNS as unknown as [string, ...string[]])).min(1).max(9),
    injured: z.boolean(),
    description: z.string().min(1).max(4000),
    mediaIds: z.array(z.string()).max(10).optional(),
  }),
  z.object({command: z.literal('finish-work'), shiftId: z.string().min(1)}),
  z.object({
    command: z.literal('close-shift'),
    shiftId: z.string().min(1),
    comment: z.string().max(2000).default(''),
  }),
]);

/** Диспетчеру в чат: происшествие важнее, чем аккуратность доставки. */
async function notifyIncident(
  result: {incidentId: string; severity: string; stopRequired: boolean},
  description: string,
) {
  const {telegramNotifier} = await import('@/core/notifications/telegram');
  await telegramNotifier.sendAlert({
    severity: result.severity === 'CRITICAL' ? 'critical' : result.severity === 'HIGH' ? 'high' : 'medium',
    message: result.stopRequired
      ? `Происшествие на смене (требуется прекратить работы): ${description}`
      : `Происшествие на смене: ${description}`,
  });
}

/**
 * Единственная точка записи для мобильного места.
 *
 * ПОЧЕМУ ОДИН МАРШРУТ НА ВСЕ КОМАНДЫ. Команд немного, и у всех одна и та же
 * обвязка: кто ты, твоя ли смена, не повтор ли это. Восемь маршрутов означали
 * бы восемь мест, где эту обвязку можно забыть.
 */
export const POST = withMutation(
  async (request: NextRequest) => {
    const {user, error} = await requireAuth(request);
    if (error || !user) {
      return NextResponse.json({error: 'Войдите в систему'}, {status: 401});
    }
    if (user.role !== 'OPERATOR') {
      return NextResponse.json({error: 'Команды смены подаёт машинист'}, {status: 403});
    }
    if (!user.tenantId) {
      return NextResponse.json({error: 'Организация пользователя не определена'}, {status: 403});
    }

    const parsed = commandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {error: 'Некорректная команда', details: parsed.error.issues},
        {status: 400},
      );
    }

    const body = parsed.data;
    const actor = {tenantId: user.tenantId, operatorId: user.id};

    try {
      switch (body.command) {
        case 'acknowledge-briefing':
          return NextResponse.json({data: await acknowledgeBriefing(actor)});
        case 'submit-knowledge':
          return NextResponse.json({data: await submitKnowledgeTest({...actor, ...body})});
        case 'accept-equipment':
          return NextResponse.json({
            data: await acceptEquipment({...actor, ...body, readWeather: getWeatherAt}),
          });
        case 'submit-checklist':
          return NextResponse.json({data: await submitChecklist({...actor, ...body})});
        case 'log-production':
          return NextResponse.json({
            data: await logProduction({...actor, ...body, readWeather: getWeatherAt}),
          });
        case 'correct-production':
          return NextResponse.json({data: await correctProduction({...actor, ...body})});
        case 'report-incident': {
          const result = await reportIncident({
            ...actor,
            shiftId: body.shiftId,
            category: body.category as Parameters<typeof reportIncident>[0]['category'],
            signs: body.signs as Parameters<typeof reportIncident>[0]['signs'],
            injured: body.injured,
            description: body.description,
            mediaIds: body.mediaIds,
            clientCommandId: body.clientCommandId,
          });
          // Оповещение — после записи и вне транзакции, «как получится».
          // Происшествие уже в журнале; молчащий Telegram не должен отменять
          // запись, а упавшая отправка — валить команду. Тем же правилом живут
          // оповещения о простое (services/reports/event-handlers).
          void notifyIncident(result, body.description).catch(() => undefined);
          return NextResponse.json({data: result});
        }
        case 'finish-work':
          return NextResponse.json({data: await finishWork({...actor, ...body})});
        case 'close-shift':
          return NextResponse.json({data: await closeShift({...actor, ...body})});
      }
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
  {domain: 'operator.mobile'},
);
