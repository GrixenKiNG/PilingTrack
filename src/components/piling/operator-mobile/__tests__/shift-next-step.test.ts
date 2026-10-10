import {describe, expect, it} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {nextStep, TOTAL_STEPS} from '../shift-next-step';

type Phase = OperatorMobileState['phase'];

function state(phase: Phase, patch: Record<string, unknown> = {}): OperatorMobileState {
  return {
    phase,
    identity: {
      ppe: {confirmed: true, missing: []},
      briefing: {ok: true, acknowledgedAt: '2026-10-07T04:00:00.000Z', title: 'Инструкция'},
      knowledge: {ok: true, validUntil: null, lastResult: null},
      documents: [],
    },
    checklists: [],
    entries: [],
    ...patch,
  } as unknown as OperatorMobileState;
}

// Владелец 07.10.2026: внизу каждого модуля оператора — «Главная»,
// «Следующий шаг» и «Завершить смену». Следующий шаг определяет фаза сервера.
describe('nextStep — что делать дальше', () => {
  it('допуск: первым ведёт СИЗ, потом инструкция, потом проверка знаний', () => {
    const noPpe = state('IDENTITY', {identity: {
      ppe: {confirmed: false, missing: []}, briefing: {ok: false, acknowledgedAt: null, title: 'И'},
      knowledge: {ok: false, validUntil: null, lastResult: null}, documents: [],
    }});
    expect(nextStep(noPpe).action).toEqual({kind: 'ADMISSION', open: 'PPE'});

    const noBriefing = state('IDENTITY', {identity: {
      ppe: {confirmed: true, missing: []}, briefing: {ok: false, acknowledgedAt: null, title: 'И'},
      knowledge: {ok: false, validUntil: null, lastResult: null}, documents: [],
    }});
    expect(nextStep(noBriefing).action).toEqual({kind: 'ADMISSION', open: 'BRIEFING'});

    const noKnowledge = state('IDENTITY', {identity: {
      ppe: {confirmed: true, missing: []}, briefing: {ok: true, acknowledgedAt: '2026-10-07', title: 'И'},
      knowledge: {ok: false, validUntil: null, lastResult: null}, documents: [],
    }});
    expect(nextStep(noKnowledge).action).toEqual({kind: 'ADMISSION', open: 'KNOWLEDGE'});
  });

  it('допуск пройден, а сервер ещё не решил — шаг «обновить», а не выдуманный допуск', () => {
    const step = nextStep(state('IDENTITY'));
    expect(step.action).toEqual({kind: 'WAIT_ADMISSION'});
    expect(step.enabled).toBe(true);
  });

  it('приём установки', () => {
    expect(nextStep(state('ADMISSION')).action).toEqual({kind: 'ACCEPT_EQUIPMENT'});
  });

  it.each([
    ['PRESHIFT_INSPECTION', 'PRESHIFT_INSPECTION'],
    ['SITE_READY', 'SITE_READY'],
    ['STARTUP', 'EO_BEFORE'],
  ] as const)('фаза %s ведёт к чек-листу %s', (phase, stage) => {
    expect(nextStep(state(phase)).action).toEqual({kind: 'CHECKLIST', stage});
  });

  it('работа: пока записей нет — записать выработку; когда есть — завершить работу', () => {
    expect(nextStep(state('WORK')).action).toEqual({kind: 'LOG_WORK'});
    expect(nextStep(state('WORK', {entries: [{id: 'e1'}]})).action).toEqual({kind: 'FINISH_WORK'});
  });

  it('сдача: пока ЕО после работы не сдано — ЕО, потом закрытие смены', () => {
    const before = state('CLOSING', {checklists: [{stage: 'EO_AFTER', done: false}]});
    expect(nextStep(before).action).toEqual({kind: 'SERVICE_AFTER'});
    const after = state('CLOSING', {checklists: [{stage: 'EO_AFTER', done: true}]});
    expect(nextStep(after).action).toEqual({kind: 'CLOSE_SHIFT'});
  });

  it('смена закрыта — шага нет, кнопка не нажимается', () => {
    const step = nextStep(state('CLOSED'));
    expect(step.action).toEqual({kind: 'NONE'});
    expect(step.enabled).toBe(false);
  });

  it('номер шага растёт вместе с фазой и не выходит за общее число', () => {
    const phases: Phase[] = ['IDENTITY', 'ADMISSION', 'PRESHIFT_INSPECTION', 'SITE_READY', 'STARTUP', 'WORK', 'CLOSING', 'CLOSED'];
    const indexes = phases.map((phase) => nextStep(state(phase)).index);
    expect(indexes).toEqual([1, 2, 3, 4, 5, 6, 7, 7]);
    expect(Math.max(...indexes)).toBe(TOTAL_STEPS);
  });

  it('у каждого шага есть название и подсказка — кнопка никогда не безымянна', () => {
    const phases: Phase[] = ['IDENTITY', 'ADMISSION', 'PRESHIFT_INSPECTION', 'SITE_READY', 'STARTUP', 'WORK', 'CLOSING', 'CLOSED'];
    for (const phase of phases) {
      const step = nextStep(state(phase));
      expect(step.title.length).toBeGreaterThan(2);
      expect(step.hint.length).toBeGreaterThan(5);
    }
  });
});
