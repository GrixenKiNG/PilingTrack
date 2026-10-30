import { formatJournalDay, formatJournalMoment, type BriefingJournalEntry, type BriefingKind, type BriefingJournalStatus, type BriefingType } from '@/modules/operator-mobile/client';
import { formatDateInTimezone } from '@/lib/timezone';

export type KindFilter = BriefingKind | '';
export type TypeFilter = BriefingType | '';
export type StatusFilter = BriefingJournalStatus | '';

/**
 * Строка журнала плюс необязательный объект. `/api/briefings/journal` пока не
 * отдаёт площадку в каждой строке, поэтому поле добавлено как необязательное
 * расширение импортируемого типа — без изменения общей формы `BriefingJournalEntry`.
 */
export type JournalRow = BriefingJournalEntry & { siteName?: string };

/**
 * Мгновение записи в поясе тенанта — тем же порядком значений, что и на печатном
 * листе журнала (R134, находка 8): рядом экран подписывает «Время тенанта», и
 * строка таблицы не должна показывать часы браузера. Инструктаж проходят до
 * начала смены, поэтому сдвиг часов менял бы дату записи. Пока пояс неизвестен —
 * прежний формат по часам браузера.
 */
export function momentInTimezone(iso: string, timezone?: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '—';
  if (!timezone) return formatJournalMoment(iso);
  const day = formatDateInTimezone(moment, timezone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = formatDateInTimezone(moment, timezone, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** День мгновения в поясе тенанта — графы «действует до» и подписей. */
export function dayInTimezone(iso: string | null, timezone?: string): string {
  if (!iso) return '—';
  if (!timezone) return formatJournalDay(iso);
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime())
    ? '—'
    : formatDateInTimezone(moment, timezone, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Отметка подписи в графе: дата по поясу тенанта или честное «нет». */
export function signatureCell(iso: string | null, timezone?: string) {
  return iso
    ? <span className="whitespace-nowrap text-success-strong">✓ {dayInTimezone(iso, timezone)}</span>
    : <span className="text-muted-foreground">—</span>;
}

/** Календарный день `ГГГГ-ММ-ДД` в поясе тенанта — сравнение «сегодня/вчера». */
export function dayKey(date: Date, timezone: string): string {
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
}

/** Шаги панели регистрации: путь от выбора человека до подписи. */
export const REGISTRATION_STEPS = [
  { title: 'Выбор сотрудника', detail: 'Найти и выбрать сотрудника' },
  { title: 'Выбор вида инструктажа', detail: 'Вводный, первичный, повторный, внеплановый, целевой' },
  { title: 'Программа инструктажа', detail: 'Выбрать из шаблона или указать основание' },
  { title: 'Электронная подпись', detail: 'Подпись сотрудника и инструктора' },
];

/** Типовые программы инструктажа — витрина шаблонов. */
export const PROGRAM_TEMPLATES = [
  'Общие требования охраны труда',
  'Работы на высоте',
  'Буровые и свайные работы',
  'Работы вблизи ЛЭП',
  'Пожарная безопасность',
];

/** Одно событие упрощённой истории изменений записи. */
export interface HistoryEvent {
  at: string;
  action: string;
  user: string;
  role: string;
  comment: string;
}
