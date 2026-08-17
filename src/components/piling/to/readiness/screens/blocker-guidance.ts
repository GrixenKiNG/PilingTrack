/**
 * «Кто снимает блокировку и где» — недостающее звено доказательного журнала.
 *
 * Журнал показывал строку «Заблокировано» и на этом заканчивался: почему
 * заблокировано, кто это держит и что нужно сделать, чтобы установка пошла в
 * работу, не было видно нигде. Для диспетчера это тупик — событие есть,
 * адресата нет.
 *
 * Текст блокировки берётся из самого снимка (авторитетный вердикт сервера), а
 * здесь лежит только маршрутизация: кто отвечает за снятие и на каком экране
 * это делается. Это знание интерфейса, а не домена, поэтому живёт рядом с
 * экранами, а не в правилах готовности.
 */

import type { ReadinessBlockerDto } from '../api/contracts';
import type { ReferenceView } from './types';

export interface BlockerGuidance {
  /** Кто снимает блокировку. */
  who: string;
  /** Куда идти. `view` — вкладка модуля техготовности, если действие внутри него. */
  where: string;
  view?: ReferenceView;
}

const GUIDANCE: Record<string, BlockerGuidance> = {
  CRITICAL_DEFECT: {
    who: 'механик',
    where: 'вкладка «Обслуживание» → замечание закрыть или понизить критичность',
    view: 'maintenance',
  },
  INSPECTION_BELOW_80: {
    who: 'оператор',
    where: 'вкладка «Смены» → дозаполнить осмотр',
    view: 'shifts',
  },
  MAINTENANCE_OVERDUE_50H: {
    who: 'механик',
    where: 'вкладка «Обслуживание» → закрыть наряд ТО с описанием работ',
    view: 'maintenance',
  },
  VALID_WORK_PERMIT_REQUIRED: {
    who: 'инженер ОТ',
    where: 'вкладка «Наряды-допуски» → оформить и согласовать наряд',
    view: 'permits',
  },
  PERMIT_EXPIRED: {
    who: 'инженер ОТ',
    where: 'вкладка «Наряды-допуски» → переоформить наряд на новый срок',
    view: 'permits',
  },
};

/** Ключ правила: в части записей он называется `code`, а не `condition`. */
export function blockerKey(blocker: ReadinessBlockerDto): string | null {
  return blocker.condition ?? blocker.code ?? null;
}

export function blockerGuidance(blocker: ReadinessBlockerDto): BlockerGuidance | null {
  const key = blockerKey(blocker);
  return key ? GUIDANCE[key] ?? null : null;
}

/**
 * Одна строка «что держит установку» для узкого места в таблице.
 *
 * Пустой список блокировок у снимка BLOCKED — не выдумываем причину: это
 * снимок старого формата, и честнее так и сказать.
 */
export function describeBlockers(blockers: readonly ReadinessBlockerDto[]): string {
  if (blockers.length === 0) return 'причина в снимке не записана';
  return blockers.map((blocker) => {
    const guidance = blockerGuidance(blocker);
    return guidance ? `${blocker.label} — снимает ${guidance.who}` : blocker.label;
  }).join('; ');
}
