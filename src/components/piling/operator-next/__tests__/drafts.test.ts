import {describe, expect, it} from 'vitest';
import {
  draftsForScope, emptyChecklistDraft, emptyDrafts, emptyFormFields, emptyPassportDraft,
  hasDirtyDraft, isFormDirty, passportAfterSubmit,
} from '../drafts';

/**
 * Находка №2 ревью и ревью №4, пункты A1–A2: хранилище черновиков выше экранов;
 * принадлежность — пара «пользователь + смена»; паспорт — такой же черновик,
 * как выработка, и по подтверждению очищается без «констант проекта».
 */
describe('черновики', () => {
  it('пустая форма — не черновик, заполненная — черновик', () => {
    expect(isFormDirty(emptyFormFields())).toBe(false);
    expect(isFormDirty({...emptyFormFields(), count: '5'})).toBe(true);
    expect(isFormDirty({...emptyFormFields(), comment: 'течь'})).toBe(true);
  });

  it('внутри одной пары «пользователь + смена» черновики сохраняются', () => {
    const drafts = emptyDrafts('u1', 'shift-1');
    drafts.work = {
      ...drafts.work,
      forms: {...drafts.work.forms, PILES: {...emptyFormFields(), reference: 'g1', count: '5'}},
    };
    expect(hasDirtyDraft(drafts)).toBe(true);
    expect(draftsForScope(drafts, 'u1', 'shift-1')).toBe(drafts);
  });

  it('новая смена начинает с чистого листа', () => {
    const drafts = emptyDrafts('u1', 'shift-1');
    drafts.work = {
      ...drafts.work,
      forms: {...drafts.work.forms, PILES: {...emptyFormFields(), count: '5'}},
    };
    const next = draftsForScope(drafts, 'u1', 'shift-2');
    expect(next.shiftId).toBe('shift-2');
    expect(hasDirtyDraft(next)).toBe(false);
    expect(next.closeNote).toBe('');
  });

  it('смена пользователя на общем планшете тоже обнуляет черновики', () => {
    const drafts = emptyDrafts('u1', 'shift-1');
    drafts.passport = {...emptyPassportDraft(), number: 'С-9'};
    const next = draftsForScope(drafts, 'u2', 'shift-1');
    expect(next.userId).toBe('u2');
    expect(next.passport).toBeNull();
    expect(next === drafts).toBe(false);
  });

  it('неизвестный пользователь — чистый лист без «anon»', () => {
    const drafts = emptyDrafts(null, 'shift-1');
    expect(drafts.userId).toBeNull();
    expect(draftsForScope(drafts, null, 'shift-1')).toBe(drafts);
    expect(draftsForScope(drafts, 'u1', 'shift-1').userId).toBe('u1');
  });

  it('паспорт после подтверждения: отправленное уходит, «константы проекта» остаются', () => {
    const draft = {
      ...emptyPassportDraft(),
      grade: 'g1',
      number: 'С-77',
      depth: '12.5',
      sets: [
        {blows: '30', penetration: '10', dropHeight: '1.2'},
        {blows: '32', penetration: '8', dropHeight: ''},
      ],
      designHead: '-1.2',
      designRefusal: '0.5',
      dropHeight: '1.2',
      note: 'скол',
      redriven: true,
    };
    const after = passportAfterSubmit(draft);
    expect(after.number).toBe('');
    expect(after.depth).toBe('');
    expect(after.sets).toHaveLength(1);
    expect(after.sets[0].penetration).toBe('');
    expect(after.note).toBe('');
    expect(after.redriven).toBe(false);
    // «Константы проекта» — на месте: подряд бьют одинаковые сваи.
    expect(after.grade).toBe('g1');
    expect(after.designHead).toBe('-1.2');
    expect(after.designRefusal).toBe('0.5');
    expect(after.dropHeight).toBe('1.2');
  });

  it('переключение вида формы не стирает соседние формы', () => {
    const drafts = emptyDrafts('u1', 'shift-1');
    const withPiles = {
      ...drafts.work,
      forms: {...drafts.work.forms, PILES: {...emptyFormFields(), count: '5'}},
    };
    const switched = {...withPiles, mode: 'DRILLING' as const};
    expect(switched.forms.PILES.count).toBe('5');
    expect(switched.forms.DRILLING.count).toBe('');
  });

  it('ответы осмотра живут по этапу и начинаются заново в новой смене', () => {
    const drafts = emptyDrafts('u1', 'shift-1');
    drafts.checklists = {
      TB_PILING: {i1: {...emptyChecklistDraft(), answer: 'OK'}},
    };
    const same = draftsForScope(drafts, 'u1', 'shift-1');
    expect(same.checklists.TB_PILING?.i1.answer).toBe('OK');
    expect(draftsForScope(drafts, 'u1', 'shift-2').checklists).toEqual({});
  });
});
