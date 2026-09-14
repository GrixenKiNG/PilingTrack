/**
 * Конец смены: объявление об окончании работ и закрытие смены с отчётом.
 *
 * После закрытия отчёт уходит в исходящий ящик (`publishReportSubmitted`) —
 * в той же транзакции, что и сама запись: иначе смена закроется, а отчёта
 * никто не увидит.
 */
import type {Prisma} from '@/generated/postgres-client/client';
import {withReadinessTenantTransaction} from '@/modules/readiness/server';
import {OperatorCommandError, requireCrew, requireOpenShift, ensureReport} from './shared';
import type {Tx} from './shared';

/** Оператор объявил, что работа закончена: дальше только ЕО после работы. */
export async function finishWork(input: {tenantId: string; operatorId: string; shiftId: string}) {
  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    // Единственная команда, где проверки закрепления не было: чужую смену
    // можно было перевести в «сдаётся» одним идентификатором. Остальные
    // команды спрашивали бригаду, эта — нет.
    await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);
    await tx.shift.update({
      where: {tenantId_id: {tenantId: input.tenantId, id: input.shiftId}},
      data: {state: 'HANDOVER_PENDING', lastEditedById: input.operatorId},
    });
    return {ok: true};
  });
}

/**
 * Закрытие смены и отправка отчёта.
 *
 * Смену принимать некому: бригада работает в одну смену, и утром установку
 * примет тот же машинист. Поэтому здесь нет передачи и подтверждения —
 * закрытие сразу отправляет отчёт диспетчеру.
 *
 * Послесменное обслуживание — условие закрытия, а не пожелание: машина,
 * оставленная без осмотра, утром становится чужой проблемой.
 */
export async function closeShift(input: {
  tenantId: string;
  operatorId: string;
  shiftId: string;
  comment: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return withReadinessTenantTransaction(input.tenantId, async (tx) => {
    const shift = await requireOpenShift(tx, input.tenantId, input.shiftId);
    const crew = await requireCrew(tx, input.tenantId, input.operatorId, shift.equipmentId);
    const started = await tx.shift.findFirst({
      where: {tenantId: input.tenantId, id: input.shiftId},
      select: {startedAt: true, timezone: true},
    });

    const done = await tx.operatorChecklistExecution.findFirst({
      where: {
        tenantId: input.tenantId,
        shiftId: input.shiftId,
        status: 'COMPLETED',
        template: {templateKey: 'EO_AFTER'},
      },
      select: {id: true},
    });
    if (!done) {
      throw new OperatorCommandError(409, 'Сначала выполните ЕО после работы');
    }

    // Отчёт может не существовать: смена без единой сваи — это тоже смена, и
    // сдать её надо, иначе простой объекта нигде не отразится.
    const reportId = await ensureReport(tx, {
      tenantId: input.tenantId,
      shiftId: input.shiftId,
      operatorId: input.operatorId,
      siteId: crew.siteId,
      equipmentId: shift.equipmentId,
      crewId: crew.id,
      productionDate: shift.productionDate.toISOString().slice(0, 10),
      shiftType: shift.type,
    });

    const [lastMeter, fuelEvidence] = await Promise.all([
      tx.meterReading.findFirst({
        where: {tenantId: input.tenantId, equipmentId: shift.equipmentId},
        orderBy: {recordedAt: 'desc'},
        select: {engineHours: true},
      }),
      tx.operatorShiftEvidence.findFirst({
        where: {tenantId: input.tenantId, shiftId: input.shiftId, kind: 'FLUID_READING'},
        orderBy: {occurredAt: 'desc'},
        select: {payload: true},
      }),
    ]);

    const fuelPayload = fuelEvidence?.payload as {fuelPercent?: number} | null;
    const fuelPercent = typeof fuelPayload?.fuelPercent === 'number'
      ? Math.round(fuelPayload.fuelPercent)
      : null;

    // Время смены в журнал отчётов: без него администратор видит «смена не
    // указана» и не знает, во сколько машина вышла и во сколько встала.
    // Часы берём из самой смены, а не из телефона: она их и так помнит.
    const timezone = started?.timezone ?? 'Europe/Moscow';
    const clock = (at: Date | null | undefined) => (at
      ? new Intl.DateTimeFormat('ru-RU', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(at)
      : null);

    await tx.report.update({
      where: {id: reportId},
      data: {
        status: 'submitted',
        submittedAt: now,
        shiftStart: clock(started?.startedAt),
        shiftEnd: clock(now),
        closingComment: input.comment,
        endingEngineHours: lastMeter?.engineHours ?? null,
        endingFuelPercent: fuelPercent,
        lastEditedById: input.operatorId,
      },
    });

    await publishReportSubmitted(tx, input.tenantId, reportId);

    await tx.shift.update({
      where: {tenantId_id: {tenantId: input.tenantId, id: input.shiftId}},
      data: {
        state: 'CLOSED', closedAt: now,
        closedById: input.operatorId, lastEditedById: input.operatorId,
      },
    });

    return {ok: true, reportId};
  });
}

/**
 * Событие «отчёт сдан» в общий журнал исходящих.
 *
 * ПОЧЕМУ ЭТО ОБЯЗАТЕЛЬНО. Дашборд и журнал отчётов читают таблицу `Report`
 * напрямую и видят смену сразу. Аналитика — нет: она живёт на проекциях
 * `ReportAnalytics` и `SiteDailySummary`, которые строит воркер по событию
 * `ReportSubmitted`. Без него смена, закрытая с телефона, в аналитику не
 * попадала вовсе: семь сданных отчётов и ноль строк проекций.
 *
 * Пишем в той же транзакции, что и сам отчёт: либо есть и запись, и событие,
 * либо нет ни того ни другого. Обработчик умеет добрать объект и оператора
 * по `reportId`, поэтому в полезной нагрузке достаточно итогов.
 */
async function publishReportSubmitted(tx: Tx, tenantId: string, reportId: string) {
  const report = await tx.report.findUnique({
    where: {id: reportId},
    select: {
      reportId: true, siteId: true, userId: true,
      piles: {select: {count: true}},
      drillings: {select: {meters: true}},
      downtimes: {select: {duration: true}},
    },
  });
  if (!report) return;

  await tx.outboxEvent.create({
    data: {
      type: 'ReportSubmitted',
      aggregateId: report.reportId,
      aggregateType: 'Report',
      tenantId,
      published: false,
      attempts: 0,
      payload: {
        siteId: report.siteId,
        userId: report.userId,
        tenantId,
        totalPiles: report.piles.reduce((sum, pile) => sum + pile.count, 0),
        totalDrilling: report.drillings.reduce((sum, drill) => sum + drill.meters, 0),
        totalDowntime: report.downtimes.reduce((sum, downtime) => sum + downtime.duration, 0),
      } as Prisma.InputJsonValue,
    },
  });
}

