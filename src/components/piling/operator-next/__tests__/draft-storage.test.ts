import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  clearPassportDraft, draftStorageKey, loadPassportDraft, loadShellDrafts,
  savePassportDraft, saveShellDrafts, storageAvailable, type PassportDraftData, type ShellDraftsData,
} from '../draft-storage';
import {emptyFormFields, emptyWorkDraft} from '../drafts';

/**
 * Ревью №3, пункт C: черновики оболочки в localStorage. Проверяем само
 * хранилище: ключ по пользователю и смене, разделы не затирают друг друга,
 * испорченное значение — как пустое, недоступное хранилище — не падение.
 */
const shell = (): ShellDraftsData => ({
  work: {
    ...emptyWorkDraft(),
    mode: 'PILES',
    forms: {...emptyWorkDraft().forms, PILES: {...emptyFormFields(), reference: 'g1', count: '4'}},
  },
  checklists: {},
  closeNote: 'заметка на завтра',
});

const passport = (): PassportDraftData => ({
  grade: 'g1',
  number: 'С-1',
  designHead: '',
  actualHead: '',
  depth: '',
  sets: [{blows: '25', penetration: '10', dropHeight: '1.2'}],
  designRefusal: '',
  totalBlows: '',
  blowsLastMeter: '',
  dropHeight: '',
  planDeviation: '',
  tilt: '',
  redriven: false,
  followerUsed: false,
  headCutOff: false,
  note: '',
});

describe('хранилище черновиков', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('ключ — по пользователю и смене', () => {
    expect(draftStorageKey('u1', 'shift-9')).toContain('u1');
    expect(draftStorageKey('u1', 'shift-9')).toContain('shift-9');
    expect(draftStorageKey(null, 'shift-9')).toContain('anon');
    expect(draftStorageKey('u1', 's')).not.toBe(draftStorageKey('u2', 's'));
  });

  it('черновик смены сохраняется и читается', () => {
    expect(saveShellDrafts('u1', 'shift-1', shell())).toBe(true);
    const loaded = loadShellDrafts('u1', 'shift-1');
    expect(loaded?.closeNote).toBe('заметка на завтра');
    expect(loaded?.work.forms.PILES.count).toBe('4');
  });

  it('чужой ключ не читается', () => {
    saveShellDrafts('u1', 'shift-1', shell());
    expect(loadShellDrafts('u2', 'shift-1')).toBeNull();
  });

  it('паспорт живёт рядом с выработкой и чистится отдельно', () => {
    saveShellDrafts('u1', 'shift-1', shell());
    expect(savePassportDraft('u1', 'shift-1', passport())).toBe(true);
    expect(loadPassportDraft('u1', 'shift-1')?.number).toBe('С-1');
    // соседний раздел не затёрт
    expect(loadShellDrafts('u1', 'shift-1')?.closeNote).toBe('заметка на завтра');
    clearPassportDraft('u1', 'shift-1');
    expect(loadPassportDraft('u1', 'shift-1')).toBeNull();
    expect(loadShellDrafts('u1', 'shift-1')?.work.forms.PILES.count).toBe('4');
  });

  it('испорченное значение — как пустое', () => {
    globalThis.localStorage.setItem(draftStorageKey('u1', 'shift-1'), '{ошибка');
    expect(loadShellDrafts('u1', 'shift-1')).toBeNull();
    expect(loadPassportDraft('u1', 'shift-1')).toBeNull();
  });

  it('недоступное хранилище — false и null, без падения', () => {
    const spy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(storageAvailable()).toBe(false);
      expect(saveShellDrafts('u1', 'shift-1', shell())).toBe(false);
      expect(loadShellDrafts('u1', 'shift-1')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
