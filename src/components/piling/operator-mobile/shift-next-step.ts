import type {ChecklistStage, OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {admissionSteps} from './safety/admission-steps';

/**
 * «Следующий шаг» и «Завершить смену» — один расчёт на все модули оператора.
 *
 * ЗАЧЕМ. Владелец 07.10.2026: внизу каждого модуля — большие кнопки «Главная»,
 * «Следующий шаг» и «Завершить смену». Что считать следующим шагом, решает
 * ФАЗА СМЕНЫ, которую ведёт сервер (domain/shift-phases): фаза вычисляется из
 * записанных фактов, поэтому после перезагрузки телефона кнопка ведёт ровно
 * туда, где человек остановился. Куда именно нажать на экране — дело самого
 * модуля: у каждого своя навигация, а ответ на вопрос «что дальше» один.
 *
 * Функция чистая: состояние на входе, описание шага на выходе. Ни запросов, ни
 * переходов здесь нет.
 */

export type NextStepAction =
  /** Допуск: одно из трёх действий человека (СИЗ, инструкция, проверка знаний). */
  | {kind: 'ADMISSION'; open: 'PPE' | 'BRIEFING' | 'KNOWLEDGE'}
  /** Всё по допуску пройдено; решение за сервером, экран его перечитывает. */
  | {kind: 'WAIT_ADMISSION'}
  | {kind: 'ACCEPT_EQUIPMENT'}
  | {kind: 'CHECKLIST'; stage: ChecklistStage}
  | {kind: 'LOG_WORK'}
  | {kind: 'FINISH_WORK'}
  /** Фаза «Сдача»: ЕО после работы ещё не сдано. */
  | {kind: 'SERVICE_AFTER'}
  | {kind: 'CLOSE_SHIFT'}
  | {kind: 'NONE'};

export interface NextStep {
  action: NextStepAction;
  /** Название шага — подпись на кнопке. */
  title: string;
  /** Что сделать, одной фразой — под кнопкой. */
  hint: string;
  /** Кнопка нажимается. */
  enabled: boolean;
  /** Номер шага и всего шагов: «Шаг 3 из 7». */
  index: number;
  total: number;
}

/** Шаги смены по порядку фаз. Столько же шагов видит человек. */
export const TOTAL_STEPS = 7;

const PHASE_INDEX: Record<OperatorMobileState['phase'], number> = {
  IDENTITY: 1,
  ADMISSION: 2,
  PRESHIFT_INSPECTION: 3,
  SITE_READY: 4,
  STARTUP: 5,
  WORK: 6,
  CLOSING: 7,
  CLOSED: TOTAL_STEPS,
};

const CHECKLIST_TITLE: Partial<Record<OperatorMobileState['phase'], {stage: ChecklistStage; title: string}>> = {
  PRESHIFT_INSPECTION: {stage: 'PRESHIFT_INSPECTION', title: 'Предсменный осмотр'},
  SITE_READY: {stage: 'SITE_READY', title: 'Осмотр площадки'},
  STARTUP: {stage: 'EO_BEFORE', title: 'Пуск и ЕО перед работой'},
};

/** Что делать дальше. Всегда возвращает шаг — «ничего» тоже ответ. */
export function nextStep(state: OperatorMobileState): NextStep {
  const index = PHASE_INDEX[state.phase];
  const step = (action: NextStepAction, title: string, hint: string, enabled = true): NextStep => ({
    action, title, hint, enabled, index, total: TOTAL_STEPS,
  });

  switch (state.phase) {
    case 'IDENTITY': {
      const pending = admissionSteps(state).find(
        (item) => item.opens !== null && item.id !== 'SIGNATURE' && !item.done,
      );
      if (pending && pending.opens) {
        return step(
          {kind: 'ADMISSION', open: pending.opens},
          pending.title,
          `Допуск: ${pending.title.toLowerCase()} — нажмите, чтобы пройти.`,
        );
      }
      return step(
        {kind: 'WAIT_ADMISSION'}, 'Допуск',
        'Всё пройдено. Допуск подтверждает сервер — нажмите, чтобы обновить.',
      );
    }
    case 'ADMISSION':
      return step({kind: 'ACCEPT_EQUIPMENT'}, 'Принять установку', 'Выберите установку и примите её.');
    case 'PRESHIFT_INSPECTION':
    case 'SITE_READY':
    case 'STARTUP': {
      const item = CHECKLIST_TITLE[state.phase];
      return step(
        {kind: 'CHECKLIST', stage: item ? item.stage : 'PRESHIFT_INSPECTION'},
        item ? item.title : 'Осмотр',
        'Ответьте на пункты списка и отправьте его.',
      );
    }
    case 'WORK':
      return state.entries.length === 0
        ? step({kind: 'LOG_WORK'}, 'Записать выработку', 'Запишите сваи, бурение или простой.')
        : step({kind: 'FINISH_WORK'}, 'Завершить работу', 'Выработка записана. Когда работа закончена — завершите её.');
    case 'CLOSING': {
      const eoAfter = state.checklists.find((list) => list.stage === 'EO_AFTER');
      return eoAfter && !eoAfter.done
        ? step({kind: 'SERVICE_AFTER'}, 'ЕО после работы', 'Пройдите осмотр после работы.')
        : step({kind: 'CLOSE_SHIFT'}, 'Закрыть смену', 'Проверьте итоги и сдайте отчёт.');
    }
    case 'CLOSED':
      return step({kind: 'NONE'}, 'Смена закрыта', 'Отчёт сдан. Новая смена начнётся завтра.', false);
  }
}

export type FinishShiftAction =
  /** Работа идёт: завершить её, дальше ЕО после работы и сдача. */
  | {kind: 'FINISH_WORK'}
  /** Работа завершена: перейти к сдаче смены. */
  | {kind: 'GO_CLOSING'}
  | {kind: 'NONE'};

export interface FinishShift {
  action: FinishShiftAction;
  enabled: boolean;
  /** Пояснение под кнопкой: что произойдёт или почему сейчас нельзя. */
  hint: string;
}

/**
 * Что делает кнопка «Завершить смену» сейчас.
 *
 * Кнопка есть всегда, но нажимается не всегда: смену нельзя завершить, пока она
 * не началась, и дважды. В недоступном состоянии она говорит, что сделать
 * сначала, а не молчит.
 */
export function finishShift(state: OperatorMobileState): FinishShift {
  switch (state.phase) {
    case 'WORK':
      return {
        action: {kind: 'FINISH_WORK'}, enabled: true,
        hint: 'Работа закончится. Дальше — ЕО после работы и сдача отчёта.',
      };
    case 'CLOSING':
      return {action: {kind: 'GO_CLOSING'}, enabled: true, hint: 'Перейти к сдаче смены.'};
    case 'CLOSED':
      return {action: {kind: 'NONE'}, enabled: false, hint: 'Смена уже закрыта.'};
    default:
      return {
        action: {kind: 'NONE'}, enabled: false,
        hint: `Смену можно завершить, когда начнётся работа. Сейчас: ${nextStep(state).title.toLowerCase()}.`,
      };
  }
}
