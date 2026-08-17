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

import type {db} from '@/lib/db';
import {withReadinessTenantTransaction} from '../infrastructure/tenant-transaction';
import {tenantProductionDate} from '../domain/shifts/tenant-production-date';
import {requestReadinessSnapshot} from './projection/request-snapshot';

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
 */
const UNFINISHED_SHIFT_STATES = ['STARTED', 'HANDOVER_PENDING'] as const;

export async function runReadinessScheduler(
  tenantId: string,
  now: Date = new Date(),
): Promise<ReadinessSchedulerResult> {
  return withReadinessTenantTransaction(tenantId, async (tx) => {
    // 1. Наряды с истёкшим сроком. Только APPROVED: черновик и наряд на
    //    согласовании срока не имеют, отозванный уже закрыт человеком.
    const expired = await tx.workPermit.updateMany({
      where: {tenantId, state: 'APPROVED', validTo: {lte: now}},
      data: {state: 'EXPIRED', expiredAt: now, version: {increment: 1}},
    });

    // 2. Незакрытые смены прошедших производственных суток. Сравнение идёт по
    //    поясу самой смены, а не сервера: в 03:00 по Москве вчерашняя смена
    //    другого пояса может ещё продолжаться.
    const unfinished = await tx.shift.findMany({
      where: {tenantId, state: {in: [...UNFINISHED_SHIFT_STATES]}},
      select: {id: true, productionDate: true, timezone: true},
    });
    const staleIds = unfinished
      .filter((shift) => shift.productionDate < tenantProductionDate(now, shift.timezone))
      .map((shift) => shift.id);

    const closed = staleIds.length === 0 ? {count: 0} : await tx.shift.updateMany({
      where: {tenantId, id: {in: staleIds}, state: {in: [...UNFINISHED_SHIFT_STATES]}},
      data: {state: 'CLOSED', closedAt: now, autoClosedAt: now, version: {increment: 1}},
    });

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
