import {beforeEach, describe, expect, it} from 'vitest';
import {ownPendingCount} from '../queue-snapshot';

/**
 * Ревью №2, п.11: «не прочитано» — это не «пусто». Проверяем счётчик, которым
 * закрытие смены решает, можно ли закрывать: ошибка чтения обязана давать
 * отрицательное значение, а не ноль, и считаются только записи вошедшего.
 */
const STORAGE_KEY = 'pilingtrack.operator.queue.v1';

describe('снимок очереди на чтение', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('пустое хранилище — ноль, а не ошибка', () => {
    expect(ownPendingCount()).toBe(0);
  });

  it('испорченное значение — «проверить не удалось», а не ноль', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, '{испорчено');
    expect(ownPendingCount()).toBe(-1);
  });

  it('не массив в хранилище — тоже «не удалось»', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({oops: true}));
    expect(ownPendingCount()).toBe(-1);
  });

  it('считает только записи вошедшего', () => {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      {ownerId: null, clientCommandId: 'mine'},
      {ownerId: 'other-user', clientCommandId: 'stranger'},
    ]));
    expect(ownPendingCount()).toBe(1);
  });
});
