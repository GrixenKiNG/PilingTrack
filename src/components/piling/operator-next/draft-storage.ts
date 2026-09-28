/**
 * Черновики экрана машиниста в localStorage.
 *
 * ЗАЧЕМ. Телефон на площадке сворачивают и перезагружают часто (экономия
 * батареи, «подвисло — перезапущу»), а смена всё та же. Черновик, живущий
 * только в памяти, перезагрузку не переживал: выработка, ответы осмотра и
 * заметка закрытия пропадали между двумя касаниями экрана (ревью №3, круг 4).
 *
 * ХРАНИТСЯ ПО ПОЛЬЗОВАТЕЛЮ И СМЕНЕ. Планшет на установке общий: черновики
 * машиниста не должны ни показываться следующему вошедшему, ни тем более
 * уходить под его именем. Ключ собирается из идентификатора вошедшего и смены;
 * чужие ключи не читаются вовсе.
 *
 * ХРАНИЛИЩЕ МОЖЕТ ОТКАЗАТЬ. Приватный режим или переполнение — не повод
 * падать: сохранение возвращает `false`, чтение — `null`, а экран честно
 * говорит, что черновик не переживёт перезагрузку.
 */

import type {Drafts, WorkDraft} from './drafts';

/** Поля паспорта сваи, снятые с формы, — структура для хранения. */
export interface PassportDraftData {
  grade: string;
  number: string;
  designHead: string;
  actualHead: string;
  depth: string;
  sets: {blows: string; penetration: string; dropHeight: string}[];
  designRefusal: string;
  totalBlows: string;
  blowsLastMeter: string;
  dropHeight: string;
  planDeviation: string;
  tilt: string;
  redriven: boolean;
  followerUsed: boolean;
  headCutOff: boolean;
  note: string;
}

/** Разделы, которые ведёт оболочка. */
export interface ShellDraftsData {
  work: WorkDraft;
  checklists: Drafts['checklists'];
  closeNote: string;
}

interface StoredDrafts {
  work?: WorkDraft;
  checklists?: Drafts['checklists'];
  closeNote?: string;
  passport?: PassportDraftData | null;
}

const KEY_PREFIX = 'piling.onx.drafts.v1';

export function draftStorageKey(userId: string | null, shiftId: string): string {
  return `${KEY_PREFIX}:${userId ?? 'anon'}:${shiftId}`;
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

function readAll(userId: string | null, shiftId: string | null): StoredDrafts | null {
  if (!shiftId) return null;
  try {
    const raw = globalThis.localStorage?.getItem(draftStorageKey(userId, shiftId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as StoredDrafts;
  } catch {
    return null;
  }
}

/**
 * Дописать разделы, не затирая соседние.
 *
 * Оболочка сохраняет выработку, осмотр и заметку; обёртка паспорта — свою
 * секцию. Читаем перед записью: иначе один сохраняющий затёр бы работу другого.
 */
function mergeWrite(userId: string | null, shiftId: string | null, patch: StoredDrafts): boolean {
  if (!shiftId) return false;
  try {
    const current = readAll(userId, shiftId) ?? {};
    const value = JSON.stringify({...current, ...patch});
    globalThis.localStorage.setItem(draftStorageKey(userId, shiftId), value);
    return true;
  } catch {
    return false;
  }
}

export function loadShellDrafts(userId: string | null, shiftId: string | null): ShellDraftsData | null {
  const stored = readAll(userId, shiftId);
  if (!stored || !stored.work || typeof stored.work !== 'object') return null;
  return {
    work: stored.work,
    closeNote: typeof stored.closeNote === 'string' ? stored.closeNote : '',
    checklists: stored.checklists && typeof stored.checklists === 'object' ? stored.checklists : {},
  };
}

export function saveShellDrafts(
  userId: string | null,
  shiftId: string | null,
  data: ShellDraftsData,
): boolean {
  return mergeWrite(userId, shiftId, data);
}

export function loadPassportDraft(userId: string | null, shiftId: string | null): PassportDraftData | null {
  const stored = readAll(userId, shiftId);
  const passport = stored?.passport;
  return passport && typeof passport === 'object' ? passport : null;
}

export function savePassportDraft(
  userId: string | null,
  shiftId: string | null,
  data: PassportDraftData,
): boolean {
  return mergeWrite(userId, shiftId, {passport: data});
}

/** Подтверждённый паспорт — не черновик: чистим по приёму сервером. */
export function clearPassportDraft(userId: string | null, shiftId: string | null): void {
  mergeWrite(userId, shiftId, {passport: null});
}
