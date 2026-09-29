/**
 * Копия черновиков экрана машиниста в localStorage.
 *
 * ЗАЧЕМ. Телефон на площадке сворачивают и перезагружают часто, а смена та же.
 * Источник правды — память оболочки (ревью №4, пункт A1); сюда она пишется
 * после каждого изменения и читается при входе в смену. Персистенции через DOM
 * больше нет: черновик паспорта — такой же объект в памяти, как выработка.
 *
 * ХРАНИТСЯ ПО ПАРЕ «ПОЛЬЗОВАТЕЛЬ + СМЕНА». Планшет общий: чужие ключи не
 * читаются и не пишутся. Пока пользователь неизвестен, пользовательские
 * черновики не читаются и не пишутся — общего «anon» нет (ревью №4, A2).
 *
 * ОШИБКА ЧТЕНИЯ — НЕ «ПУСТО» (ревью №4, Д3). Если `getItem` отказал, данные
 * могут существовать: запись поверх неизвестного содержимого не выполняется, а
 * вызывающий получает честный статус ошибки. Испорченное значение (не
 * разбирается) — как пустое: восстанавливать из него нечего.
 */
import type {Drafts, PassportDraftData, WorkDraft} from './drafts';

export type {PassportDraftData} from './drafts';

/** Разделы, которые ведёт оболочка. */
export interface ShellDraftsData {
  work: WorkDraft;
  checklists: Drafts['checklists'];
  closeNote: string;
  passport: PassportDraftData | null;
}

/** Результат чтения: ошибка отличается от «данных нет». */
export type DraftRead<Value> =
  | {status: 'ok'; value: Value}
  | {status: 'error'};

const KEY_PREFIX = 'piling.onx.drafts.v1';

/** Ключ пары; у неизвестного пользователя ключа нет — писать некуда. */
export function draftStorageKey(userId: string | null, shiftId: string | null): string | null {
  if (!userId || !shiftId) return null;
  return `${KEY_PREFIX}:${userId}:${shiftId}`;
}

/** Проверка записи: недоступное или переполненное хранилище — `false`. */
export function storageAvailable(): boolean {
  try {
    const probe = `${KEY_PREFIX}:probe`;
    globalThis.localStorage.setItem(probe, '1');
    globalThis.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readAll(userId: string | null, shiftId: string | null): DraftRead<ShellDraftsData | null> {
  const key = draftStorageKey(userId, shiftId);
  if (!key) return {status: 'ok', value: null};
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return {status: 'error'};
  }
  if (raw === null) return {status: 'ok', value: null};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Испорченное значение восстановить нечем — считаем черновик отсутствующим.
    return {status: 'ok', value: null};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {status: 'ok', value: null};
  }
  const stored = parsed as Partial<ShellDraftsData>;
  if (!stored.work || typeof stored.work !== 'object') return {status: 'ok', value: null};
  return {
    status: 'ok',
    value: {
      work: stored.work as WorkDraft,
      closeNote: typeof stored.closeNote === 'string' ? stored.closeNote : '',
      checklists: stored.checklists && typeof stored.checklists === 'object' ? stored.checklists : {},
      passport: stored.passport && typeof stored.passport === 'object' ? stored.passport : null,
    },
  };
}

/** Прочитать черновик пары. Ошибка чтения — статус `error`, не «пусто». */
export function loadShellDrafts(
  userId: string | null,
  shiftId: string | null,
): DraftRead<ShellDraftsData | null> {
  return readAll(userId, shiftId);
}

/**
 * Записать черновик пары после изменения.
 *
 * Перед записью читаем: ошибка чтения останавливает запись — поверх
 * неизвестного содержимого не пишем.
 */
export function saveShellDrafts(
  userId: string | null,
  shiftId: string | null,
  data: ShellDraftsData,
): boolean {
  const key = draftStorageKey(userId, shiftId);
  if (!key) return false;
  const current = readAll(userId, shiftId);
  if (current.status === 'error') return false;
  try {
    const value = JSON.stringify({
      work: data.work,
      checklists: data.checklists,
      closeNote: data.closeNote,
      passport: data.passport ?? null,
    });
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
