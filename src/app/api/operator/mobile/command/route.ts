import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {withMutation} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {
  acceptEquipment, acknowledgeBriefing, closeShift, confirmPpe, finishWork, logProduction,
  OperatorCommandError, correctProduction, reportIncident, submitChecklist, submitKnowledgeTest,
} from '@/modules/operator-mobile';
import {INCIDENT_CATEGORIES, INCIDENT_SIGNS} from '@/modules/operator-mobile/contracts';
// Напрямую из `application`, а не через `@/modules/readiness`: тот барьер
// импортируют клиентские компоненты, и серверный модуль в нём тянет `lib/db`
// в браузерный бандл.
import {DOWNTIME_MAX_HOURS, roundDowntimeHours} from '@/modules/reports/domain/downtime-hours';
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
    command: z.literal('confirm-ppe'),
    // Производственные сутки считает клиент по часовому поясу работника — тот
    // же расчёт, что в выборке состояния. Формат проверяем строго: мусор в
    // дате тихо создал бы запись не за те сутки.
    productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    items: z.array(z.string().min(1).max(32)).max(20),
  }),
  z.object({
    command: z.literal('submit-knowledge'),
    attemptToken: z.string().min(1).max(4096),
    picks: z.array(z.object({
      questionId: z.string().min(1),
      picked: z.number().int().min(0).max(9),
    })).length(8),
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
        kind: z.literal('PILE_PASSPORT'),
        pileGradeId: z.string().min(1),
        // Обязателен только номер сваи: остальное машинист дописывает по ходу,
        // и половина замеров появляется уже после забивки. Границы широкие и
        // отсекают опечатку, а не оценивают качество работы — это дело приёмки.
        passport: z.object({
          pileNumber: z.string().trim().min(1).max(50),
          picketId: z.string().min(1).optional(),
          // Залоги журнала забивки. Предел в 60 — не оценка работы, а потолок
          // против мусорной отправки: свая за 60 залогов по 10 ударов — это
          // 600 ударов, вдвое больше любой реальной забивки.
          sets: z.array(z.object({
            blows: z.number().int().min(1).max(1000),
            penetrationMm: z.number().min(0).max(10_000),
            dropHeightM: z.number().min(0).max(20).nullish(),
          })).max(60).optional(),
          // Отметка головы бывает отрицательной: отсчёт от нуля здания.
          designHeadLevelM: z.number().min(-200).max(200).nullish(),
          actualHeadLevelM: z.number().min(-200).max(200).nullish(),
          drivenDepthM: z.number().min(0).max(200).nullish(),
          refusalSetPenetrationMm: z.number().min(0).max(10_000).nullish(),
          refusalSetBlows: z.number().int().min(1).max(1000).nullish(),
          designRefusalMm: z.number().min(0).max(1000).nullish(),
          totalBlows: z.number().int().min(0).max(100_000).nullish(),
          blowsLastMeter: z.number().int().min(0).max(100_000).nullish(),
          redriven: z.boolean().optional(),
          followerUsed: z.boolean().optional(),
          headCutOff: z.boolean().optional(),
          planDeviationMm: z.number().min(0).max(10_000).nullish(),
          tiltPercent: z.number().min(0).max(100).nullish(),
          dropHeightM: z.number().min(0).max(20).nullish(),
          mediaIds: z.array(z.string()).max(10).optional(),
          note: z.string().max(2000).optional(),
        }),
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
        // Простой измеряется полными часами: неполный округляется вверх
        // (правило и причина — reports/domain/downtime-hours). Округляем, а не
        // отвергаем: старый телефон в кармане не обязан знать о правиле.
        // Максимум в 24 отсекает опечатку «ввёл минуты».
        hours: z.number().min(0.1).max(DOWNTIME_MAX_HOURS).transform(roundDowntimeHours),
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
        case 'confirm-ppe':
          return NextResponse.json({data: await confirmPpe({...actor, ...body})});
        case 'submit-knowledge':
          return NextResponse.json({data: await submitKnowledgeTest({...actor, ...body})});
        case 'accept-equipment':
          return NextResponse.json({
            data: await acceptEquipment({...actor, ...body, readWeather: getWeatherAt}),
          });
        case 'submit-checklist': {
          const result = await submitChecklist({...actor, ...body});
          return NextResponse.json({data: result});
        }
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
