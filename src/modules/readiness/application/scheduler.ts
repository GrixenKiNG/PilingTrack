/**
 * Суточный сброс контура техготовности.
 *
 * Две вещи, которых не делал никто, и от которых модуль превращался в «вечный
 * процесс»:
 *
 * 1. Наряд-допуск никогда не становился истёкшим. Переход `expire` в домене
 *    был написан, но не вызывался ниоткуда: команды умеют создать, подать,
 *    согласовать и отозвать. Срок кончался, а в списке наряд по-прежнему
 *    «согласован» — при том что расчёт готовности уже считал его просроченным.
 *    Данные говорили одно, экран другое.
 *
 * 2. Смена закрывалась только через принятую передачу. Не сдали или не приняли
 *    — смена висела «в работе» бесконечно, и утром оператор видел вчерашнюю.
 *
 * Обе операции идут внутри `withReadinessTenantTransaction`: шесть таблиц
 * техготовности закрыты fail-closed, и без установленного `app.current_tenant`
 * планировщик получил бы пустые выборки — молча, без ошибки.
 *
 * Идемпотентность: обе выборки отбирают только те строки, которые ещё не
 * обработаны (наряд в APPROVED, смена в работе). Повторный прогон в тот же
 * день ничего не находит и ничего не делает.
 */

import {randomUUID} from 'node:crypto';
import type {db} from '@/lib/db';
import {withReadinessTenantTransaction} from '../infrastructure/tenant-transaction';
import {normalizeTenantTimezone, tenantProductionDate} from '../domain/shifts/tenant-production-date';
import {requestReadinessSnapshot} from './projection/request-snapshot';
import {recordChainedReadinessAudit} from '../infrastructure/audit/record-audit';

/**
 * Кто именно поменял состояние, когда это сделал не человек.
 *
 * Без явного актора событие выглядело бы как действие с пустым автором, и при
 * разборе «кто закрыл смену» ответа не было бы вовсе. `id` пустой намеренно:
 * пользователя за этим нет, и придумывать его нельзя.
 */
const SCHEDULER_ACTOR = {id: null, name: 'Планировщик техготовности', role: 'SYSTEM'} as const;

export interface ReadinessSchedulerResult {
  permitsExpired: number;
  shiftsAutoClosed: number;
  recalcRequested: number;
}

/**
 * Состояния смены, которые считаются «работа шла, но её не закрыли».
 *
 * PLANNED и PENDING_ACCEPTANCE сюда намеренно не входят: смена, которую так и
 * не начали, — это несостоявшийся план, а не забытая работа. Закрывать её как
 * выполненную было бы враньём в журнале; такие остаются диспетчеру на разбор.
 *
 * HANDOVER_PENDING не входит по той же причине, но обходилась она дороже.
 * Смена в этом состоянии ждёт решения человека: сдающий расписался,
 * принимающий — ещё нет. Автозакрытие переводило смену в CLOSED, а её
 * `ShiftHandover` оставался SUBMITTED. Принять такую передачу становилось
 * невозможно НАВСЕГДА: приёмка закрывает смену и требует от неё состояния
 * HANDOVER_PENDING, а смена уже закрыта. Оператор упирался в «Получение
 * установки», кнопка отвечала 409, машина оставалась запертой.
 *
 * Ждущая приёмки смена — это незакрытое решение, а не забытая работа.
 */
const UNFINISHED_SHIFT_STATES = ['STARTED'] as const;

/**
 * Час следующих суток, с которого смена прошлых суток считается брошенной.
 *
 * Не полночь: ночная смена 19:00–07:00 после полуночи уже «вчерашняя» по
 * дате, но ещё идёт, и прогон в 00:30 обрывал её посреди работы. Полдень
 * оставляет ночной смене пять часов запаса. Забытую дневную смену до полудня
 * никто не теряет: утром оператор видит её на экране и закрывает сам.
 */
const AUTO_CLOSE_HOUR_NEXT_DAY = 12;

function isAutoCloseDue(productionDate: Date, timezone: string | null, now: Date): boolean {
  const today = tenantProductionDate(now, timezone).getTime();
  const nextDay = productionDate.getTime() + 24 * 60 * 60 * 1000;
  if (today !== nextDay) return today > nextDay;
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: normalizeTenantTimezone(timezone), hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  return hour >= AUTO_CLOSE_HOUR_NEXT_DAY;
}

export async function runReadinessScheduler(
  tenantId: string,
  now: Date = new Date(),
): Promise<ReadinessSchedulerResult> {
  // Один идентификатор на весь прогон. У команд человека он приходит из
  // HTTP-запроса, у планировщика запроса нет — но связать между собой все
  // переходы одного ночного прогона нужно так же (и этого требует ограничение
  // `AuditLog_native_chain_complete`: звено цепочки без корреляции не примут).
  const runId = randomUUID();

  return withReadinessTenantTransaction(tenantId, async (tx) => {
    // 1. Наряды с истёкшим сроком. Только APPROVED: черновик и наряд на
    //    согласовании срока не имеют, отозванный уже закрыт человеком.
    //
    // Сначала выбираем строки, потом обновляем по их идентификаторам: слепой
    // `updateMany` не оставлял следа, кто и что поменял, а модуль стоит на
    // доказательности. Внутри одной транзакции выбранный набор и есть
    // обновлённый.
    const expiring = await tx.workPermit.findMany({
      where: {tenantId, state: 'APPROVED', validTo: {lte: now}},
      select: {id: true, version: true, state: true, validTo: true},
    });
    const expired = expiring.length === 0 ? {count: 0} : await tx.workPermit.updateMany({
      where: {tenantId, id: {in: expiring.map((permit) => permit.id)}, state: 'APPROVED'},
      data: {state: 'EXPIRED', expiredAt: now, version: {increment: 1}},
    });
    for (const permit of expiring) {
      await recordChainedReadinessAudit(tx, {
        tenantId,
        action: 'work-permit.expired',
        entityType: 'WorkPermit',
        entityId: permit.id,
        entityVersion: permit.version + 1,
        actor: SCHEDULER_ACTOR,
        requestId: runId,
        correlationId: runId,
        occurredAt: now,
        before: {state: permit.state, version: permit.version,
          validTo: permit.validTo ? permit.validTo.toISOString() : null},
        after: {state: 'EXPIRED', version: permit.version + 1, expiredAt: now.toISOString()},
        metadata: {trigger: 'SCHEDULER', reason: 'VALIDITY_ELAPSED'},
      });
    }

    // 2. Незакрытые смены прошедших производственных суток — с полудня
    //    следующих (см. AUTO_CLOSE_HOUR_NEXT_DAY). Сравнение идёт по поясу
    //    самой смены, а не сервера.
    const unfinished = await tx.shift.findMany({
      where: {tenantId, state: {in: [...UNFINISHED_SHIFT_STATES]}},
      select: {id: true, productionDate: true, timezone: true, version: true, state: true},
    });
    const stale = unfinished
      .filter((shift) => isAutoCloseDue(shift.productionDate, shift.timezone, now));
    const staleIds = stale.map((shift) => shift.id);

    const closed = staleIds.length === 0 ? {count: 0} : await tx.shift.updateMany({
      where: {tenantId, id: {in: staleIds}, state: {in: [...UNFINISHED_SHIFT_STATES]}},
      data: {state: 'CLOSED', closedAt: now, autoClosedAt: now, version: {increment: 1}},
    });
    // Автозакрытие — единственный способ закрыть смену без отчёта, послесменного
    // осмотра и передачи. Именно поэтому оно обязано быть видно при разборе:
    // `autoClosedAt` в строке отличает такую смену, а событие говорит когда и
    // на каком основании она закрыта.
    for (const shift of stale) {
      await recordChainedReadinessAudit(tx, {
        tenantId,
        action: 'shift.auto-closed',
        entityType: 'Shift',
        entityId: shift.id,
        entityVersion: shift.version + 1,
        actor: SCHEDULER_ACTOR,
        requestId: runId,
        correlationId: runId,
        occurredAt: now,
        before: {state: shift.state, version: shift.version,
          productionDate: shift.productionDate.toISOString().slice(0, 10)},
        after: {state: 'CLOSED', version: shift.version + 1, autoClosedAt: now.toISOString()},
        metadata: {trigger: 'SCHEDULER', reason: 'PRODUCTION_DAY_ELAPSED', timezone: shift.timezone},
      });
    }

    // Выработка автозакрытой смены — такая же выработка. Черновик без события
    // «сдан» навсегда оставался мимо аналитики (проекции строит воркер по
    // ReportSubmitted), поэтому сдаём его здесь, в той же транзакции. Пометка
    // `autoClosed` в событии нужна уведомлению: оператор отчёт не сдавал, и
    // писать диспетчеру «отчёт отправлен» от его имени было бы неправдой.
    //
    // Полезная нагрузка — та же, что у publishReportSubmitted в
    // operator-mobile/shift-close: импортировать оттуда нельзя, тот модуль
    // сам зависит от техготовности.
    const drafts = staleIds.length === 0 ? [] : await tx.report.findMany({
      where: {tenantId, shiftId: {in: staleIds}, status: 'draft'},
      select: {
        id: true, reportId: true, siteId: true, userId: true,
        piles: {select: {count: true}},
        drillings: {select: {meters: true}},
        downtimes: {select: {duration: true}},
      },
    });
    if (drafts.length > 0) {
      await tx.report.updateMany({
        where: {tenantId, id: {in: drafts.map((report) => report.id)}, status: 'draft'},
        data: {status: 'submitted', submittedAt: now},
      });
    }
    for (const report of drafts) {
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
            autoClosed: true,
          },
        },
      });
    }

    // 3. Пересчёт готовности на новые сутки.
    //
    // Это лечит главную ложь экрана: `CurrentReadiness` пересчитывался ТОЛЬКО
    // по событию — закрыли наряд ТО, сняли моточасы, начали смену. Пока
    // событий нет, на экране висит снимок того дня, когда они были: машина с
    // «100/100 · рассчитано 10 августа» на деле не имеет сегодняшнего осмотра
    // и сегодня стоит 50. Пользователь каждое утро видел вчерашние цифры и
    // «выполненные» шаги чек-листа при незапущенной смене.
    //
    // Сутки — это событие само по себе: критерий «осмотр выполнен» привязан к
    // производственным суткам и обнуляется в полночь без всякого действия
    // человека. Заказ идёт через ту же очередь, что и остальные пересчёты,
    // поэтому доказательный снимок и журнал не теряются.
    //
    // Ключ дедупликации содержит дату: повторный прогон в те же сутки нового
    // пересчёта не закажет.
    const productionDate = tenantProductionDate(now, null).toISOString().slice(0, 10);
    const fleet = await tx.equipment.findMany({
      where: {tenantId, isActive: true},
      select: {id: true},
    });
    for (const equipment of fleet) {
      await requestReadinessSnapshot(tx as unknown as typeof db, {
        tenantId,
        equipmentId: equipment.id,
        aggregateId: equipment.id,
        aggregateType: 'Equipment',
        triggerType: 'DAILY_RECALC',
        triggerId: productionDate,
        occurredAt: now,
      });
    }

    return {
      permitsExpired: expired.count,
      shiftsAutoClosed: closed.count,
      recalcRequested: fleet.length,
    };
  });
}
