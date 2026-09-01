/**
 * Плановое окно смены.
 *
 * ЗАЧЕМ. На экране «Смены» центра готовности есть временнáя шкала: по ней
 * диспетчер видит, кто и когда работает. Смена без плановых часов рисуется
 * прочерками — в списке она есть, а на графике её нет.
 *
 * ОТКУДА ЧАСЫ. Из принятого в продукте расписания: дневная 08:00–20:00,
 * ночная 20:00–08:00 следующих суток. Ровно это подписано на самой шкале.
 * Отдельной настройки под них в продукте нет, поэтому значения живут здесь
 * одной константой, а не разбросаны по вызовам.
 *
 * Фактические начало и конец смены плановых не заменяют: план — это когда
 * машина должна работать, факт — когда работала. Расхождение между ними и есть
 * то, ради чего график смотрят.
 */
export const SHIFT_WINDOW = {
  DAY: {startHour: 8, endHour: 20},
  NIGHT: {startHour: 20, endHour: 32}, // 32 = 08:00 следующих суток
} as const;

/**
 * Смещение часового пояса в минутах на конкретный момент.
 *
 * Считается через раскладку той же даты в нужном поясе: другого способа учесть
 * переход на летнее время средствами платформы нет. Для Москвы перехода нет,
 * но продукт рассчитан и на другие пояса.
 */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(
    parts.find((part) => part.type === type)?.value ?? '0',
  );
  const asUtc = Date.UTC(
    read('year'), read('month') - 1, read('day'),
    read('hour') % 24, read('minute'), read('second'),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Момент, соответствующий локальному часу производственных суток.
 *
 * `productionDate` — полночь суток, записанная как UTC (так их хранит продукт).
 * `hour` может быть больше 23: 32 означает 08:00 следующего дня.
 */
export function localHourInstant(productionDate: Date, hour: number, timeZone: string): Date {
  const base = new Date(productionDate.getTime() + hour * 3_600_000);
  // Смещение берём на приблизительный момент, затем уточняем: около перехода
  // на летнее время первая оценка может промахнуться на час.
  const first = new Date(base.getTime() - zoneOffsetMinutes(base, timeZone) * 60_000);
  return new Date(base.getTime() - zoneOffsetMinutes(first, timeZone) * 60_000);
}

/** Плановые начало и конец смены в поясе организации. */
export function shiftWindow(
  productionDate: Date,
  type: 'DAY' | 'NIGHT',
  timeZone: string,
): {plannedStartAt: Date; plannedEndAt: Date} {
  const window = SHIFT_WINDOW[type];
  return {
    plannedStartAt: localHourInstant(productionDate, window.startHour, timeZone),
    plannedEndAt: localHourInstant(productionDate, window.endHour, timeZone),
  };
}
