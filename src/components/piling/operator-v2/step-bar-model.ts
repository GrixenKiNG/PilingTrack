import type {NextStep} from '../operator-mobile/shift-next-step';
import {V2_STEPS, V2_STEP_STAGE, V2_STEP_TITLE, type V2Step} from './shift-flow';

/**
 * Нижняя панель шагов для модуля v2 (решение владельца 07.10.2026).
 *
 * У v2 свой порядок экранов (`shift-flow.ts`), и он не совпадает с фазами
 * рабочего места один к одному: допуск и приёмка слиты, а «Завершить работу»
 * ставит признак на вкладке. Поэтому панель здесь строится по шагу v2, а не по
 * фазе сервера: человек видит те же названия, что в шапке экрана.
 */

/** Шагов в общем счёте: восемь экранов минус финальный «Смена закрыта». */
const TOTAL = V2_STEPS.length - 1;

const HINT: Record<V2Step, string> = {
  acceptance: 'Выберите установку и примите её.',
  inspection: 'Ответьте на пункты осмотра и отправьте список.',
  'site-safety': 'Проверьте площадку и отправьте список.',
  startup: 'Запустите машину, ответьте на пункты и отправьте список.',
  work: 'Запишите сваи, бурение или простой. Когда работа закончена — завершите её.',
  'post-inspection': 'Пройдите осмотр после работы.',
  report: 'Проверьте итоги и сдайте отчёт.',
  closed: 'Отчёт сдан. Новая смена начнётся завтра.',
};

export function v2NextStep(step: V2Step): NextStep {
  const index = Math.min(V2_STEPS.indexOf(step) + 1, TOTAL);
  const base = {title: V2_STEP_TITLE[step], hint: HINT[step], enabled: step !== 'closed', index, total: TOTAL};
  switch (step) {
    case 'acceptance':
      return {...base, action: {kind: 'ACCEPT_EQUIPMENT'}};
    case 'inspection':
    case 'site-safety':
    case 'startup': {
      const stage = V2_STEP_STAGE[step];
      return {...base, action: {kind: 'CHECKLIST', stage: stage ?? 'PRESHIFT_INSPECTION'}};
    }
    case 'work':
      return {...base, action: {kind: 'LOG_WORK'}};
    case 'post-inspection':
      return {...base, action: {kind: 'SERVICE_AFTER'}};
    case 'report':
      return {...base, action: {kind: 'CLOSE_SHIFT'}};
    case 'closed':
      return {...base, action: {kind: 'NONE'}};
  }
}
