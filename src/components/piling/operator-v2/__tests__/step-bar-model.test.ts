import {describe, expect, it} from 'vitest';
import {V2_STEPS} from '../shift-flow';
import {v2FinishShift, v2NextStep} from '../step-bar-model';

// Владелец 07.10.2026: панель «Главная / Следующий шаг / Завершить смену» — во
// всех модулях оператора. У v2 свой порядок экранов, панель строится по нему.
describe('v2NextStep', () => {
  it('у каждого шага есть название, подсказка и номер в пределах общего числа', () => {
    for (const step of V2_STEPS) {
      const result = v2NextStep(step);
      expect(result.title.length).toBeGreaterThan(2);
      expect(result.hint.length).toBeGreaterThan(5);
      expect(result.index).toBeGreaterThanOrEqual(1);
      expect(result.index).toBeLessThanOrEqual(result.total);
    }
  });

  it('номер шага растёт по порядку экранов', () => {
    const indexes = V2_STEPS.map((step) => v2NextStep(step).index);
    for (let i = 1; i < indexes.length; i += 1) expect(indexes[i]).toBeGreaterThanOrEqual(indexes[i - 1]);
    expect(v2NextStep('acceptance').index).toBe(1);
  });

  it('осмотры ведут к своим чек-листам каталога', () => {
    expect(v2NextStep('inspection').action).toEqual({kind: 'CHECKLIST', stage: 'PRESHIFT_INSPECTION'});
    expect(v2NextStep('site-safety').action).toEqual({kind: 'CHECKLIST', stage: 'SITE_READY'});
    expect(v2NextStep('startup').action).toEqual({kind: 'CHECKLIST', stage: 'EO_BEFORE'});
  });

  it('смена закрыта — шаг не нажимается', () => {
    const result = v2NextStep('closed');
    expect(result.enabled).toBe(false);
    expect(result.action).toEqual({kind: 'NONE'});
  });
});

describe('v2FinishShift', () => {
  it('в работе завершает работу', () => {
    expect(v2FinishShift('work')).toMatchObject({action: {kind: 'FINISH_WORK'}, enabled: true});
  });

  it('после работы ведёт к сдаче', () => {
    expect(v2FinishShift('post-inspection')).toMatchObject({action: {kind: 'GO_CLOSING'}, enabled: true});
    expect(v2FinishShift('report')).toMatchObject({action: {kind: 'GO_CLOSING'}, enabled: true});
  });

  it.each(['acceptance', 'inspection', 'site-safety', 'startup'] as const)(
    'до работы (%s) не нажимается и называет, что сделать сначала', (step) => {
      const result = v2FinishShift(step);
      expect(result.enabled).toBe(false);
      expect(result.hint).toMatch(/Сейчас:/);
    },
  );

  it('после закрытия не нажимается', () => {
    expect(v2FinishShift('closed')).toMatchObject({enabled: false});
  });
});
