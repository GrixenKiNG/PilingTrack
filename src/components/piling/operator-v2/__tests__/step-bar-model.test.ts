import {describe, expect, it} from 'vitest';
import {V2_STEPS} from '../shift-flow';
import {v2NextStep} from '../step-bar-model';

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
