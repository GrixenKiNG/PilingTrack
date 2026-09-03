/**
 * Порядок экранов смены в модуле-кандидате (v2).
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ ДЕЙСТВУЮЩЕГО `operator/shift-phase.ts`. Там «Приёмка
 * машины» показывается ТОЛЬКО когда предыдущая смена оставила передачу
 * (`incomingHandover`). Первая смена на машине, смена после простоя, смена
 * после ремонта — передачи нет, и шаг молча пропускается: человек открывает
 * смену и сразу оказывается на осмотре. Отсюда жалоба «нет получения
 * установки».
 *
 * Здесь приёмка — обязательный шаг всегда. Оператор в любом случае принимает
 * машину: смотрит на неё, сверяет моточасы и расписывается. Передача от
 * предыдущей смены — это лишь дополнительные сведения на том же шаге, а не
 * условие его существования.
 *
 * ПОЧЕМУ ДО РАБОТЫ РОВНО ШЕСТЬ ЭКРАНОВ (решение владельца 30.08.2026). Раньше
 * их было восемь, и каждый узел осмотра открывался своей карточкой — до
 * рычагов человек проходил пятнадцать-двадцать экранов. Норматив на штатную
 * смену без замечаний: 7–10 минут всего, из них не больше 3–5 минут в
 * телефоне. Такой путь помещается в шесть последовательных экранов, а
 * подробности раскрываются ВНУТРИ них:
 *
 *   1. Допуск            — одна карточка, документы проверены автоматически
 *   2. Принятие установки — машина, моточасы, погода, передача
 *   3. Предсменный осмотр — один список разделов, раскрывается по одному
 *   4. Площадка и ТБ      — зона, коммуникации, СИЗ в одном сценарии
 *   5. Запуск и проверка  — пуск двигателя и функции без нагрузки
 *   6. Работа
 *
 * Осмотр после работ, отчёт и закрытие идут ПОСЛЕ работы и в эти шесть не
 * входят — их считать «дорогой до рычагов» неверно.
 *
 * ЧЕГО НЕТ. Приёмка без передачи, чек-лист площадки и функциональная проверка
 * нигде не сохраняются: под них нет ни таблиц, ни команд. Заводить схему под
 * невыбранный вариант преждевременно, поэтому они живут в памяти вкладки и
 * помечены на экране.
 */

import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';

export const V2_STEPS = [
  'admission',
  'acceptance',
  'inspection',
  'site-safety',
  'startup',
  'work',
  'post-inspection',
  'report',
  'closed',
] as const;

export type V2Step = (typeof V2_STEPS)[number];

export const V2_STEP_TITLE: Record<V2Step, string> = {
  admission: 'Допуск',
  acceptance: 'Принятие установки',
  inspection: 'Предсменный осмотр',
  'site-safety': 'Площадка и ТБ',
  startup: 'Запуск и проверка',
  work: 'Работа',
  'post-inspection': 'Послесменный осмотр',
  report: 'Отчёт о смене',
  closed: 'Смена закрыта',
};

/** Экраны до рычагов включительно. Всё, что дальше, — уже после работы. */
export const V2_PRE_WORK_STEPS = V2_STEPS.slice(0, 6) as readonly V2Step[];
export const V2_PRE_WORK_COUNT = V2_PRE_WORK_STEPS.length;

const isPreWork = (step: V2Step) => V2_PRE_WORK_STEPS.includes(step);

/**
 * Подпись под заголовком. До работы — «Шаг N из 6»: человек видит, сколько
 * осталось. После работы счётчик врал бы («шаг 7 из 6»), поэтому там просто
 * сказано, что смена уже отработана.
 */
export function stepCaption(step: V2Step): string {
  if (isPreWork(step)) return `Шаг ${V2_PRE_WORK_STEPS.indexOf(step) + 1} из ${V2_PRE_WORK_COUNT}`;
  return 'После работы';
}

/** Что оператор подтвердил в этой сессии — на сервере эти шаги не хранятся. */
export interface V2Session {
  /** Личный допуск просмотрен и подтверждён. */
  admitted: boolean;
  /** Машина принята. */
  accepted: boolean;
  /** Чек-лист площадки и ТБ пройден. */
  siteSafetyDone: boolean;
  /** Функциональная проверка после пуска двигателя пройдена. */
  startupDone: boolean;
  /** Оператор сам нажал «Завершить работу». */
  finishing: boolean;
}

export interface V2State {
  step: V2Step;
  /** Что мешает двигаться дальше. Пусто — путь открыт. */
  blockers: string[];
}

/**
 * Какой экран оператор проходит сейчас.
 *
 * @param facts состояние смены с сервера
 * @param session что подтверждено в этой вкладке (см. `V2Session`)
 */
export function resolveV2State(facts: OperatorShiftFacts, session: V2Session): V2State {
  const started = facts.shift?.state === 'STARTED' || facts.shift?.state === 'HANDOVER_PENDING';

  // Допуск по документам — раньше всего: с просроченным удостоверением
  // человеку нельзя за рычаги, и обсуждать осмотр незачем.
  if (!started) {
    if (facts.clearance.blockers.length > 0) {
      return { step: 'admission', blockers: facts.clearance.blockers };
    }
    if (!session.admitted) {
      return { step: 'admission', blockers: [] };
    }
  }

  if (facts.assignments.length === 0) {
    return {
      step: 'acceptance',
      blockers: ['Установка не закреплена — обратитесь к администратору'],
    };
  }
  if (!facts.shift) {
    return { step: 'acceptance', blockers: [] };
  }
  if (facts.shift.state === 'HANDOVER_PENDING') {
    return { step: 'closed', blockers: [] };
  }

  if (facts.shift.state === 'STARTED') {
    // Смена идёт — человек работает, а не заполняет отчёт. Пока он сам не
    // нажал «Завершить работу», экран остаётся на «Работе».
    //
    // Без этого признака шаг «Работа» был недостижим: сразу после пуска
    // экран прыгал на осмотр после работ (а у машины без такого раздела — на
    // отчёт), то есть предлагал закрывать смену в момент её начала.
    if (!session.finishing) {
      return { step: 'work', blockers: [] };
    }
    const postDone = facts.inspection.postShift?.status === 'COMPLETED';
    // Требуем только выполнимое: нет раздела «после работ» в шаблоне машины —
    // осмотра для неё не существует, и смена не должна на нём застревать.
    if (!postDone && facts.postShiftAvailable) {
      return { step: 'post-inspection', blockers: [] };
    }
    return {
      step: 'report',
      blockers: facts.report?.status === 'submitted' ? [] : ['Сменный отчёт не отправлен'],
    };
  }

  // До пуска: приёмка → осмотр → площадка → запуск.
  const incoming = facts.incomingHandover;
  const handoverPending = Boolean(incoming && incoming.shiftId !== facts.shift.id);
  if (!session.accepted || handoverPending) {
    return { step: 'acceptance', blockers: [] };
  }
  if (facts.inspection.preShift?.status !== 'COMPLETED') {
    return { step: 'inspection', blockers: [] };
  }
  if (!session.siteSafetyDone) {
    return { step: 'site-safety', blockers: [] };
  }
  const readinessBlockers = facts.readiness?.blockers.map((item) => item.label) ?? [];
  const allowed = readinessBlockers.length === 0 || facts.startWaiver !== null;
  return { step: 'startup', blockers: allowed ? [] : readinessBlockers };
}
