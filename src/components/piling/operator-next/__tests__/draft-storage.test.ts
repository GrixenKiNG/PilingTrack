import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  draftStorageKey, loadShellDrafts, saveShellDrafts, storageAvailable,
  type ShellDraftsData,
} from '../draft-storage';
import {emptyFormFields, emptyPassportDraft, emptyWorkDraft} from '../drafts';

/**
 * Ревью №3, пункт C и ревью №4, пункты A2–A3: хранилище черновиков.
 * Ключ — только пара «пользователь + смена» (общего «anon» нет); ошибка чтения
 * отличается от «данных нет» и не даёт записать поверх; недоступное хранилище —
 * не падение, а честный `false`.
 */
const shell = (): ShellDraftsData => ({
  work: {
    ...emptyWorkDraft(),
    mode: 'PILES',
    forms: {...emptyWorkDraft().forms, PILES: {...emptyFormFields(), reference: 'g1', count: '4'}},
  },
  checklists: {},
  closeNote: 'заметка на завтра',
  passport: null,
});

const passport = () => ({
  ...emptyPassportDraft(),
  grade: 'g1',
  number: 'С-1',
  sets: [{blows: '25', penetration: '10', dropHeight: '1.2'}],
});

const readValue = (read: ReturnType<typeof loadShellDrafts>) => {
  expect(read.status).toBe('ok');
  return read.status === 'ok' ? read.value : null;
};

describe('хранилище черновиков', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('ключ — по паре «пользователь + смена»; у неизвестного пользователя ключа нет', () => {
    const key = draftStorageKey('u1', 'shift-9');
    expect(key).toContain('u1');
    expect(key).toContain('shift-9');
    expect(draftStorageKey('u1', 's')).not.toBe(draftStorageKey('u2', 's'));
    // Никакого общего «anon»: без пользователя или смены ключа нет вовсе.
    expect(draftStorageKey(null, 'shift-9')).toBeNull();
    expect(draftStorageKey('u1', null)).toBeNull();
  });

  it('черновик пары сохраняется и читается', () => {
    expect(saveShellDrafts('u1', 'shift-1', shell())).toBe(true);
    const loaded = readValue(loadShellDrafts('u1', 'shift-1'));
    expect(loaded?.closeNote).toBe('заметка на завтра');
    expect(loaded?.work.forms.PILES.count).toBe('4');
  });

  it('чужой ключ не читается', () => {
    saveShellDrafts('u1', 'shift-1', shell());
    expect(readValue(loadShellDrafts('u2', 'shift-1'))).toBeNull();
  });

  it('паспорт живёт рядом с выработкой и не воскрешает отправленное', () => {
    saveShellDrafts('u1', 'shift-1', {...shell(), passport: passport()});
    const withPassport = readValue(loadShellDrafts('u1', 'shift-1'));
    expect(withPassport?.passport?.number).toBe('С-1');
    // После подтверждения оболочка пишет очищенный черновик: соседние разделы
    // остаются, паспорт — без отправленных полей.
    saveShellDrafts('u1', 'shift-1', {...shell(), passport: null});
    const cleared = readValue(loadShellDrafts('u1', 'shift-1'));
    expect(cleared?.passport ?? null).toBeNull();
    expect(cleared?.work.forms.PILES.count).toBe('4');
  });

  it('пока пользователь неизвестен — ни чтения, ни записи (ключа не появляется)', () => {
    expect(saveShellDrafts(null, 'shift-1', shell())).toBe(false);
    expect(readValue(loadShellDrafts(null, 'shift-1'))).toBeNull();
    expect(globalThis.localStorage.length).toBe(0);
  });

  it('испорченное значение — как пустое', () => {
    globalThis.localStorage.setItem(draftStorageKey('u1', 'shift-1') ?? '', '{ошибка');
    expect(readValue(loadShellDrafts('u1', 'shift-1'))).toBeNull();
  });

  it('отказ чтения при существующем документе — документ не меняется, запись отклонена', () => {
    const key = draftStorageKey('u1', 'shift-1') as string;
    saveShellDrafts('u1', 'shift-1', shell());
    const before = globalThis.localStorage.getItem(key);
    const getSpy = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    try {
      // Ошибка чтения — это НЕ «пусто»: писать поверх неизвестного содержимого нельзя.
      expect(saveShellDrafts('u1', 'shift-1', {...shell(), closeNote: 'другое'})).toBe(false);
      const read = loadShellDrafts('u1', 'shift-1');
      expect(read.status).toBe('error');
    } finally {
      getSpy.mockRestore();
    }
    // Документ остался прежним.
    expect(globalThis.localStorage.getItem(key)).toBe(before);
  });

  it('недоступное хранилище — false и статус ошибки, без падения', () => {
    const spy = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(storageAvailable()).toBe(false);
      expect(saveShellDrafts('u1', 'shift-1', shell())).toBe(false);
      expect(readValue(loadShellDrafts('u1', 'shift-1'))).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
