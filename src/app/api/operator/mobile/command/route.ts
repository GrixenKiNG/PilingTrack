import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {withMutation} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {
  acceptEquipment, closeShift, logProduction, OperatorCommandError, requestClosing, submitChecklist,
} from '@/modules/operator-mobile';

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
  z.object({
    command: z.literal('accept-equipment'),
    clientCommandId: z.string().min(8).max(64),
    equipmentId: z.string().min(1),
    engineHours: z.number().int().min(0).max(1_000_000),
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
        picketId: z.string().optional(),
        comment: z.string().max(500).optional(),
      }),
      z.object({
        kind: z.literal('DRILLING'),
        typeId: z.string().min(1),
        count: z.number().int().min(1).max(500),
        meters: z.number().min(0.1).max(10_000),
        picketId: z.string().optional(),
      }),
      z.object({
        kind: z.literal('DOWNTIME'),
        reasonId: z.string().min(1),
        // Простой измеряется в часах во всём приложении. Здесь тоже часы,
        // и максимум в 24 отсекает опечатку «ввёл минуты».
        hours: z.number().min(0.1).max(24),
        comment: z.string().max(500).optional(),
      }),
    ]),
  }),
  z.object({command: z.literal('request-closing'), shiftId: z.string().min(1)}),
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
 * обвязка: кто ты, твоя ли смена, не повтор ли это. Пять маршрутов означали бы
 * пять мест, где эту обвязку можно забыть.
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
        case 'accept-equipment':
          return NextResponse.json({data: await acceptEquipment({...actor, ...body})});
        case 'submit-checklist':
          return NextResponse.json({data: await submitChecklist({...actor, ...body})});
        case 'log-production':
          return NextResponse.json({data: await logProduction({...actor, ...body})});
        case 'request-closing':
          return NextResponse.json({data: await requestClosing({...actor, ...body})});
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
