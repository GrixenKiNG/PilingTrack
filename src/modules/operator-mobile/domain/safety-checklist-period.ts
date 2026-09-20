import {addMonths, SAFETY_INSTRUCTIONS} from '@/modules/safety';
import type {ChecklistStage} from './checklist-types';

/**
 * Когда машинисту снова проходить чек-лист ТБ.
 *
 * ЧТО БЫЛО И ПОЧЕМУ ЭТО НЕВЕРНО. Чек-лист ТБ требовался ЗАНОВО КАЖДУЮ СМЕНУ,
 * перед первой сваей и перед первой скважиной. За месяц это сорок прохождений
 * одного и того же списка правил, и к третьему разу человек отвечает не
 * читая. Норматив требует другого: инструктаж по охране труда повторяют ПО
 * ГРАФИКУ, а не ежедневно.
 *
 * ПОЧЕМУ СРОК БЕРЁТСЯ У ИНСТРУКЦИИ, А НЕ ЗАВОДИТСЯ СВОЙ. Периодичность
 * повторного инструктажа уже живёт в каталоге инструкций (repeatMonths) —
 * там её ведёт инженер по охране труда, и по ней же считается просрочка в
 * сводке допуска и в разделе «Мой допуск». Второй календарь рядом означал бы
 * два разных ответа на вопрос «когда человеку снова проходить ТБ»: один на
 * экране машиниста, другой у инженера. Поэтому здесь нет ни одного своего
 * числа — только ссылка на инструкцию.
 *
 * СИЗ ЗДЕСЬ НЕТ НАМЕРЕННО. Средства защиты проверяются каждую смену — это
 * ежедневное действие, и его место на допуске, а не в периодическом списке.
 */

/** Какая инструкция задаёт срок для какого чек-листа ТБ. */
export const TB_INSTRUCTION_CODE: Record<'TB_PILING' | 'TB_DRILLING', string> = {
  TB_PILING: 'И-СМ-04',
  TB_DRILLING: 'И-СМ-04',
};

/**
 * За сколько дней до срока зажигается предупреждение.
 *
 * Неделя — это запас на выходные и на смену в поле: человек успевает пройти
 * чек-лист сам, не упираясь в запрет работы посреди рабочего дня.
 */
export const TB_WARN_DAYS = 7;

const DAY_MS = 24 * 3600 * 1000;

export function isPeriodicSafetyStage(
  stage: ChecklistStage,
): stage is 'TB_PILING' | 'TB_DRILLING' {
  return stage === 'TB_PILING' || stage === 'TB_DRILLING';
}

/** Сколько месяцев между прохождениями по инструкции, стоящей за этапом. */
export function repeatMonthsFor(stage: 'TB_PILING' | 'TB_DRILLING'): number {
  const code = TB_INSTRUCTION_CODE[stage];
  const instruction = SAFETY_INSTRUCTIONS.find((item) => item.code === code);
  // Инструкции нет в каталоге — срока не выдумываем: чек-лист становится
  // обязательным каждый раз, как было раньше. Тихо разрешить работу без ТБ
  // из-за опечатки в коде инструкции нельзя.
  return instruction?.repeatMonths ?? 0;
}

export interface SafetyChecklistPeriod {
  /** Пройти нужно сейчас: срок вышел или не проходили ни разу. */
  due: boolean;
  /** Срок подходит — предупреждаем заранее, но работать не мешаем. */
  warn: boolean;
  /** Когда чек-лист пройден последний раз. null — ни разу. */
  lastPassedAt: string | null;
  /** До какого числа действует прошлое прохождение. null — ни разу. */
  validUntil: string | null;
  /** Сколько дней осталось. Отрицательное — просрочено. null — ни разу. */
  daysLeft: number | null;
}

/**
 * @param lastPassedAt последнее ЗАВЕРШЁННОЕ прохождение этого чек-листа
 *                     машинистом — по всем сменам, а не только по текущей
 */
export function safetyChecklistPeriod(
  stage: 'TB_PILING' | 'TB_DRILLING',
  lastPassedAt: Date | string | null,
  now: Date = new Date(),
): SafetyChecklistPeriod {
  const months = repeatMonthsFor(stage);
  if (lastPassedAt === null || months <= 0) {
    return {due: true, warn: false, lastPassedAt: null, validUntil: null, daysLeft: null};
  }

  const passed = lastPassedAt instanceof Date ? lastPassedAt : new Date(lastPassedAt);
  if (Number.isNaN(passed.getTime())) {
    return {due: true, warn: false, lastPassedAt: null, validUntil: null, daysLeft: null};
  }

  const until = addMonths(passed, months);
  const daysLeft = Math.floor((until.getTime() - now.getTime()) / DAY_MS);
  return {
    due: until.getTime() <= now.getTime(),
    warn: daysLeft >= 0 && daysLeft <= TB_WARN_DAYS,
    lastPassedAt: passed.toISOString(),
    validUntil: until.toISOString(),
    daysLeft,
  };
}
