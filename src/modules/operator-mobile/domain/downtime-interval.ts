/**
 * Проверка интервала простоя против смены и уже записанных простоев.
 *
 * ЗАЧЕМ. Длительность простоя считается по интервалу, и сумма интервалов идёт
 * в отчёт. Два перекрывающихся простоя складывались бы дважды, а простой,
 * начатый до смены, приписывал бы ей чужие часы: в данных уже был отчёт с
 * четырьмя часами простоя в смене длиной девятнадцать минут.
 *
 * Допуск пять минут — тот же, что у запрета на будущее время в записи простоя:
 * часы телефона и сервера расходятся, и отказ из-за минуты рассинхрона был бы
 * придиркой, а не защитой.
 */
import {downtimeHoursBetween} from '@/lib/downtime-hours';

const CLOCK_SKEW_MS = 5 * 60_000;

export interface DowntimeSpan {
  startedAt: Date;
  endedAt: Date;
}

/** Конец с учётом перехода через полночь — ровно как считает длительность. */
function effectiveEnd(span: DowntimeSpan): number {
  return span.startedAt.getTime() + downtimeHoursBetween(span.startedAt, span.endedAt) * 3_600_000;
}

export type DowntimeConflict =
  | {kind: 'BEFORE_SHIFT'; shiftStartedAt: Date}
  | {kind: 'OVERLAP'; other: DowntimeSpan};

/**
 * @returns первое нарушение либо null. Касание концами («10:00–10:30» и
 *   «10:30–11:00») нарушением не считается: это два простоя подряд.
 */
export function findDowntimeConflict(
  candidate: DowntimeSpan,
  shiftStartedAt: Date | null,
  recorded: DowntimeSpan[],
): DowntimeConflict | null {
  if (shiftStartedAt && candidate.startedAt.getTime() < shiftStartedAt.getTime() - CLOCK_SKEW_MS) {
    return {kind: 'BEFORE_SHIFT', shiftStartedAt};
  }

  const start = candidate.startedAt.getTime();
  const end = effectiveEnd(candidate);
  for (const other of recorded) {
    if (start < effectiveEnd(other) && other.startedAt.getTime() < end) {
      return {kind: 'OVERLAP', other};
    }
  }
  return null;
}
