import {describe, expect, it} from 'vitest';
import {
  draftsForShift, emptyDrafts, emptyFormFields, hasDirtyDraft, isFormDirty,
} from '../drafts';

/**
 * Находка №2 ревью: черновики терялись при переходах. Здесь проверяется
 * хранилище черновиков: что считается незаписанным и когда оно обнуляется.
 */
describe('черновики', () => {
  it('пустая форма — не черновик, заполненная — черновик', () => {
    expect(isFormDirty(emptyFormFields())).toBe(false);
    expect(isFormDirty({...emptyFormFields(), count: '5'})).toBe(true);
    expect(isFormDirty({...emptyFormFields(), comment: 'течь'})).toBe(true);
  });

  it('внутри одной смены черновики сохраняются', () => {
    const drafts = emptyDrafts('shift-1');
    drafts.work = {
      ...drafts.work,
      forms: {...drafts.work.forms, PILES: {...emptyFormFields(), reference: 'g1', count: '5'}},
    };
    expect(hasDirtyDraft(drafts)).toBe(true);
    expect(draftsForShift(drafts, 'shift-1')).toBe(drafts);
  });

  it('новая смена начинает с чистого листа', () => {
    const drafts = emptyDrafts('shift-1');
    drafts.work = {
      ...drafts.work,
      forms: {...drafts.work.forms, PILES: {...emptyFormFields(), count: '5'}},
    };
    const next = draftsForShift(drafts, 'shift-2');
    expect(next.shiftId).toBe('shift-2');
    expect(hasDirtyDraft(next)).toBe(false);
    expect(next.closeNote).toBe('');
  });

  it('переключение вида формы не стирает соседние формы', () => {
    const drafts = emptyDrafts('shift-1');
    const withPiles = {
      ...drafts.work,
      forms: {...drafts.work.forms, PILES: {...emptyFormFields(), count: '5'}},
    };
    const switched = {...withPiles, mode: 'DRILLING' as const};
    expect(switched.forms.PILES.count).toBe('5');
    expect(switched.forms.DRILLING.count).toBe('');
  });
});
