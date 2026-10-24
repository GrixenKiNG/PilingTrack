import type { ChecklistStage, DocumentVerdict, OperatorMobileState } from '@/modules/operator-mobile';
import { admissionSteps } from '../safety/admission-steps';
import {documentsSummary} from '../safety/documents-summary';
import { type ScreenTab, type Tone } from './v10-ui';

/**
 * Модуль оператора v10 — рабочее место машиниста на телефоне.
 *
 * ЧТО ЗДЕСЬ ПОКАЗАНО. Только то, что пришло с сервера. Демонстрационных
 * значений в живом пути нет ни одного: пустое поле показывается прочерком, а
 * не значением макета. Так было не всегда — прежняя версия подставляла
 * «ЖК Северный квартал» и документ «№ 77MA 123456 · действует» вместо
 * недостающих полей, и делала это при уже зажжённой пометке «данные с
 * сервера». На экране допуска и документов это самая дорогая ложь из
 * возможных: человек уходит на площадку, считая, что допуск есть.
 *
 * ЧТО ЗДЕСЬ МОЖНО СДЕЛАТЬ. Приём установки, предсменный осмотр (с ответом по
 * каждому пункту) и закрытие смены. Правила проверяет сервер: порядок этапов,
 * право записывать и условия закрытия живут там, экран только подсказывает.
 *
 * ПОЧЕМУ ОСМОТР НЕЛЬЗЯ СДАТЬ ОДНОЙ КНОПКОЙ. Прежняя версия на «Подтвердить
 * готовность» отправляла весь чек-лист с ответом «норма» по каждому пункту —
 * гусеницы, трещины в мачте, обрывы прядей троса, замок обоймы, — не показав
 * человеку ни одного. Осмотр это доказательство, что машину смотрели; такая
 * кнопка превращала его в доказательство, что нажали кнопку. Теперь ответы
 * проставляет человек, и пока есть пункты без ответа, сдать нельзя.
 */

/* ------------------------------------------------------- вспомогательное --- */

export const DOC_LABEL: Record<DocumentVerdict, string> = {
  VALID: 'действует', EXPIRING: 'истекает', EXPIRED: 'просрочен', MISSING: 'не заведён',
};

export const DOC_TONE: Record<DocumentVerdict, Tone> = {
  VALID: 'ok', EXPIRING: 'warn', EXPIRED: 'bad', MISSING: 'bad',
};

/** Прочерк вместо выдуманного значения. */
export const DASH = '—';

export function dateRu(value: Date | string | null | undefined): string {
  if (!value) return DASH;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return DASH;
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

export function timeRu(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}

export function shiftType(): 'DAY' | 'NIGHT' {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'DAY' : 'NIGHT';
}

/* --------------------------------------------------------------- экраны --- */

interface ScreenDef {
  id: string;
  n: number;
  title: string;
  short: string;
  tab: string;
}

export const SCREENS: ScreenDef[] = [
  {id: 'today', n: 1, title: 'Смена', short: 'Лента смены', tab: 'today'},
  {id: 'docs', n: 2, title: 'Документы', short: 'Документы', tab: 'more'},
  {id: 'accept', n: 3, title: 'Принять установку', short: 'Приёмка', tab: 'today'},
  {id: 'step', n: 4, title: 'Текущий шаг', short: 'Шаг', tab: 'today'},
  {id: 'work', n: 6, title: 'Работа', short: 'Работа', tab: 'today'},
  {id: 'maint', n: 7, title: 'Ежесменное обслуживание', short: 'Обслуживание', tab: 'equip'},
  {id: 'closing', n: 8, title: 'Закрытие смены', short: 'Закрытие', tab: 'more'},
  {id: 'report', n: 9, title: 'Отчёт и синхронизация', short: 'Отчёт', tab: 'more'},
  {id: 'safety', n: 10, title: 'ТБ и допуски', short: 'ТБ', tab: 'safety'},
  {id: 'ppe', n: 11, title: 'Средства защиты', short: 'СИЗ', tab: 'safety'},
  {id: 'briefing', n: 12, title: 'Ознакомление с инструкцией', short: 'Инструкция', tab: 'safety'},
  {id: 'knowledge', n: 13, title: 'Проверка знаний по ТБ', short: 'Знания', tab: 'safety'},
  {id: 'incidents', n: 15, title: 'Происшествия', short: 'ЧП', tab: 'safety'},
  {id: 'tb', n: 16, title: 'Чек-листы ТБ', short: 'ТБ по работам', tab: 'safety'},
  {id: 'more', n: 14, title: 'Ещё', short: 'Ещё', tab: 'more'},
];

/**
 * Нижнее меню: четыре раздела, один набор во всех модулях оператора.
 *
 * Было шесть. «Работа» ушла в «Смену» — приёмка, осмотр и учёт это один
 * сквозной ход, и разрывать его вкладкой незачем. «Отчёт» ушёл в «Ещё»:
 * закрытие смены бывает раз в день, а постоянная кнопка под однократное
 * действие — это шесть часов мёртвого места.
 */
export const TABS: ScreenTab[] = [
  {key: 'today', title: 'Смена', icon: 'home', screen: 'today'},
  {key: 'safety', title: 'ТБ', icon: 'safety', screen: 'safety'},
  {key: 'equip', title: 'Техника', icon: 'equip', screen: 'maint'},
  {key: 'more', title: 'Ещё', icon: 'more', screen: 'more'},
];

/* ------------------------------------------------------ порядок смены --- */

type Phase = OperatorMobileState['phase'];

/**
 * Шаги смены — строго по порядку, который ведёт сервер (domain/shift-phases).
 *
 * ПОЧЕМУ ЛЕСТНИЦА, А НЕ ВКЛАДКИ (жалоба владельца 28.09.2026: «логика
 * вразброс, можно сразу закрыть смену»). Экран раньше давал открыть осмотр,
 * ЕО, работу и закрытие в любом порядке, а сервер отказывал — и человек не
 * понимал, что за чем. Теперь фаза сервера — единственный источник: сделанные
 * шаги отмечены, нажать можно только текущий, будущие закрыты до своей очереди.
 */
export const STEPS: {phase: Phase; title: string}[] = [
  {phase: 'IDENTITY', title: 'Допуск: СИЗ, инструктаж, проверка знаний'},
  {phase: 'ADMISSION', title: 'Принять установку'},
  {phase: 'PRESHIFT_INSPECTION', title: 'Предсменный осмотр'},
  {phase: 'SITE_READY', title: 'Осмотр площадки'},
  {phase: 'STARTUP', title: 'Пуск и ЕО перед работой'},
  {phase: 'WORK', title: 'Работа: сваи, бурение, простой'},
  {phase: 'CLOSING', title: 'ЕО после работы и закрытие смены'},
];

/** Чек-лист, который закрывает фазу (тот же, что в domain/shift-phases). */
export const PHASE_STAGE: Partial<Record<Phase, ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  SITE_READY: 'SITE_READY',
  STARTUP: 'EO_BEFORE',
  CLOSING: 'EO_AFTER',
};

/** Номер текущего шага; для закрытой смены — за последним. */
export function stepIndex(phase: Phase): number {
  const index = STEPS.findIndex((step) => step.phase === phase);
  return index === -1 ? STEPS.length : index;
}

/* ------------------------------------------------------------ состояние --- */

export type Go = (id: string) => void;

/**
 * Строка ТБ в разделе допуска: срок ближайшего периодического чек-листа.
 *
 * Показываем худшее из двух: просроченный важнее того, у которого запас три
 * месяца. Человеку нужен один ответ — надо ли идти проходить.
 */
export function tbTone(state: OperatorMobileState | null): Tone {
  const lists = state?.checklists.filter((list) => list.period !== null) ?? [];
  if (lists.some((list) => list.period?.due)) return 'bad';
  if (lists.some((list) => list.period?.warn)) return 'warn';
  return 'ok';
}

export function tbNote(state: OperatorMobileState | null): string {
  const lists = state?.checklists.filter((list) => list.period !== null) ?? [];
  if (lists.length === 0) return 'нет доступных списков';
  const due = lists.filter((list) => list.period?.due);
  if (due.length > 0) return `подошёл срок: ${due.map((list) => list.title).join(', ')}`;
  const soon = lists
    .map((list) => list.period?.daysLeft)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)[0];
  return soon === undefined ? 'сроки не определены' : `ближайший срок через ${soon} дн.`;
}

/* --------------------------------------------------- шаги допуска (ТБ) --- */

/** Куда ведёт смена по её фазе — для кнопки «Далее» после подтверждения СИЗ. */
function nextScreen(state: OperatorMobileState): string {
  switch (state.phase) {
    case 'IDENTITY': return 'safety';
    case 'ADMISSION': return 'accept';
    case 'PRESHIFT_INSPECTION': case 'SITE_READY': case 'STARTUP': return 'step';
    case 'WORK': return 'work';
    case 'CLOSING': case 'CLOSED': return 'closing';
    default: return 'maint';
  }
}

/**
 * Итог подтверждения СИЗ и куда ведёт «Далее».
 *
 * D-20260927-003: подтвердив комплект, человек оставался на том же экране с той
 * же кнопкой — «СИЗ подтверждены» мелькало во всплывающей строке, а «допуск
 * пройден» было видно только в другом разделе. Итог и следующий шаг считаются
 * здесь, разметка — в `ScreenPpe`; правило то же, что в `/operator`: пока сервер
 * держит фазу `IDENTITY`, допуск не объявляем.
 */
export function ppeOutcome(state: OperatorMobileState): {title: string; note: string; screen: string} {
  if (state.phase !== 'IDENTITY') {
    return {title: 'Вы допущены к смене', note: 'Допуск пройден', screen: nextScreen(state)};
  }
  const next = admissionSteps(state)
    .find((step) => step.id !== 'SIGNATURE' && step.opens !== null && !step.done);
  if (next && next.opens) {
    return {title: 'СИЗ подтверждены', note: `Дальше: ${next.title}`, screen: STEP_SCREEN[next.opens]};
  }
  return {title: 'СИЗ подтверждены', note: 'Все шаги допуска пройдены', screen: 'safety'};
}

export function documentsTone(state: OperatorMobileState | null): Tone {
  if (!state) return '';
  const summary = documentsSummary(state.identity.documents);
  if (summary.blocking > 0) return 'bad';
  if (summary.expiring > 0) return 'warn';
  return 'ok';
}

export const STEP_ICON: Record<string, string> = {
  PPE: 'safety', BRIEFING: 'doc', KNOWLEDGE: 'list', SIGNATURE: 'check', ADMISSION: 'shield',
};

export const STEP_SCREEN: Record<'PPE' | 'BRIEFING' | 'KNOWLEDGE', string> = {
  PPE: 'ppe', BRIEFING: 'briefing', KNOWLEDGE: 'knowledge',
};
