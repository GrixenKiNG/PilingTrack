/**
 * Общий слой журнала инструктажей для экрана и печатной формы.
 *
 * Обе поверхности показывают одни и те же строки и обязаны называть их
 * одинаково: в распечатке стоит подпись, и расхождение с экраном — это спор о
 * том, что человек подписал. Поэтому названия видов и границы периода живут
 * здесь, а не копиями в двух местах.
 *
 * Чистые данные и чистые функции: файл попадает в браузерный пакет.
 */

export type BriefingKind = 'INSTRUCTION' | 'KNOWLEDGE';

/**
 * Вид инструктажа по охране труда — пять значений, заданных нормативом.
 *
 * Порядок здесь — порядок жизни работника: вводный при приёме, первичный на
 * рабочем месте, дальше повторные по графику, внеплановые по событию и
 * целевые под разовую работу. В этом же порядке они стоят в сводке за день.
 */
export type BriefingType = 'INDUCTION' | 'PRIMARY' | 'REPEAT' | 'UNSCHEDULED' | 'TARGETED';

export const BRIEFING_TYPE_ORDER: readonly BriefingType[] = [
  'INDUCTION', 'PRIMARY', 'REPEAT', 'UNSCHEDULED', 'TARGETED',
];

export const BRIEFING_TYPE_LABELS: Record<BriefingType, string> = {
  INDUCTION: 'Вводный',
  PRIMARY: 'Первичный',
  REPEAT: 'Повторный',
  UNSCHEDULED: 'Внеплановый',
  TARGETED: 'Целевой',
};

/** Состояние записи: обе отметки стоят или нет. */
export type BriefingJournalStatus = 'signed' | 'awaiting';

export const BRIEFING_STATUS_LABELS: Record<BriefingJournalStatus, string> = {
  signed: 'Подтверждён',
  awaiting: 'Ожидает подтверждения',
};

/** Вид записи словами — так он стоит в графе журнала и в распечатке. */
export const BRIEFING_KIND_LABELS: Record<BriefingKind, string> = {
  INSTRUCTION: 'Ознакомление с инструкцией',
  KNOWLEDGE: 'Проверка знаний',
};

/** Одна строка журнала в том виде, в каком её отдаёт `/api/briefings/journal`. */
export interface BriefingJournalEntry {
  id: string;
  recordedAt: string;
  kind: BriefingKind;
  userId: string;
  userName: string;
  userRole: string;
  documentCode: string;
  documentTitle: string;
  documentVersion: string;
  result: string | null;
  validUntil: string | null;
  /** Вид инструктажа. null у проверки знаний и у записей до 13.09.2026. */
  type: BriefingType | null;
  instructorId: string | null;
  instructorName: string;
  reason: string;
  employeeSignedAt: string | null;
  instructorSignedAt: string | null;
  status: BriefingJournalStatus;
}

/**
 * Мгновение записи для журнала: дата и время одними часами.
 *
 * ПОЧЕМУ НЕ `formatRuDate`. Та функция нарочно не ходит через `new Date()`, а
 * вырезает дату из строки — то есть показывает день по UTC. Для даты без времени
 * это правильно, а для мгновения даёт расхождение: инструктаж в 01:30 по Москве
 * получил бы вчерашнюю дату и сегодняшнее время в одной графе. В журнале час
 * важен — инструктаж проходят до начала смены, — поэтому оба значения берутся из
 * одного локального момента.
 */
export function formatJournalMoment(iso: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '—';
  return `${moment.toLocaleDateString('ru-RU')}, ${moment.toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit',
  })}`;
}

/** День мгновения по местным часам — для графы «действует до». */
export function formatJournalDay(iso: string | null): string {
  if (!iso) return '—';
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? '—' : moment.toLocaleDateString('ru-RU');
}

/** Календарный день в виде `ГГГГ-ММ-ДД` — то, что отдаёт `<input type="date">`. */
export function toDayValue(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Период по умолчанию — текущий месяц: журнал смотрят и сдают месяцами. */
export function currentMonthRange(now: Date = new Date()): {from: string; to: string} {
  return {
    from: toDayValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDayValue(now),
  };
}

/**
 * Границы периода в мгновения времени.
 *
 * ПОЧЕМУ НЕ ОТДАЁМ СЕРВЕРУ САМИ ДАТЫ. `new Date('2026-09-30')` — это полночь
 * UTC, то есть три часа ночи по Москве: записи последнего дня журнала остались
 * бы за границей выборки. Конец дня достраиваем явно, по часам того, кто
 * смотрит журнал.
 *
 * Перевёрнутый период (конец раньше начала) разворачиваем, а не отдаём пустой
 * список: пустой журнал за сентябрь читается как «инструктажей не было».
 */
export function dayRangeToInstants(fromDay: string, toDay: string): {from: string; to: string} {
  const start = startOfDay(fromDay);
  const end = endOfDay(toDay);
  return start.getTime() <= end.getTime()
    ? {from: start.toISOString(), to: end.toISOString()}
    : {from: startOfDay(toDay).toISOString(), to: endOfDay(fromDay).toISOString()};
}

function startOfDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1, 0, 0, 0, 0);
}

function endOfDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1, 23, 59, 59, 999);
}
