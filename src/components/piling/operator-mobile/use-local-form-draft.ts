'use client';

import {useCallback, useEffect, useState, type Dispatch, type SetStateAction} from 'react';

const DAY = 24 * 60 * 60 * 1000;
type Snapshot<T> = {key: string | null; value: T; initial: T; dirty: boolean; restored: boolean};

function remove(key: string | null) {
  if (!key) return;
  try { window.localStorage.removeItem(key); } catch { /* Storage is optional. */ }
}

function read<T extends Record<string, unknown>>(key: string | null, initial: T): Snapshot<T> {
  const empty = {key, value: initial, initial, dirty: false, restored: false};
  if (!key || typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return empty;
    const saved = JSON.parse(raw) as {version?: number; updatedAt?: number; value?: T};
    if (saved.version !== 1 || typeof saved.updatedAt !== 'number'
      || !Number.isFinite(saved.updatedAt) || saved.updatedAt > Date.now()
      || Date.now() - saved.updatedAt >= DAY || !saved.value || typeof saved.value !== 'object' || Array.isArray(saved.value)
      || !Object.keys(initial).every((field) => Array.isArray(initial[field])
        ? Array.isArray(saved.value?.[field])
        : initial[field] !== null && typeof initial[field] === 'object'
          ? saved.value?.[field] !== null && typeof saved.value?.[field] === 'object' && !Array.isArray(saved.value?.[field])
          : typeof saved.value?.[field] === typeof initial[field])) {
      remove(key);
      return empty;
    }
    return {...empty, value: {...initial, ...saved.value}, restored: true};
  } catch {
    remove(key);
    return empty;
  }
}

/** Local, user-scoped input only; a command accepted or queued explicitly clears it. */
export function useLocalFormDraft<T extends Record<string, unknown>>(
  userId: string | null | undefined,
  scope: string | null | undefined,
  initial: T,
  isEmpty?: (value: T) => boolean,
) {
  const key = userId && scope ? `pilingtrack:form-draft:v1:${encodeURIComponent(userId)}:${encodeURIComponent(scope)}` : null;
  const [snapshot, setSnapshot] = useState(() => read(key, initial));
  let active = snapshot;
  if (snapshot.key !== key) {
    // A new user/shift must never receive or persist the previous scope's input.
    active = read(key, initial);
    setSnapshot(active);
  }

  useEffect(() => {
    if (!active.key || !active.dirty) return;
    try {
      if (isEmpty ? isEmpty(active.value) : JSON.stringify(active.value) === JSON.stringify(active.initial)) {
        window.localStorage.removeItem(active.key);
      } else {
        const previous = window.localStorage.getItem(active.key);
        if (previous && JSON.stringify((JSON.parse(previous) as {value?: T}).value) === JSON.stringify(active.value)) return;
        window.localStorage.setItem(active.key, JSON.stringify({version: 1, updatedAt: Date.now(), value: active.value}));
      }
    } catch { /* Private mode and a full storage must not block the form. */ }
  }, [active, isEmpty]);

  const update: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setSnapshot((current) => current.key === key ? ({...current, dirty: true,
      value: typeof next === 'function' ? next(current.value) : next}) : current);
  }, [key]);
  const field = <K extends keyof T>(name: K): [T[K], Dispatch<SetStateAction<T[K]>>] => [
    active.value[name],
    (next) => update((current) => ({...current,
      [name]: typeof next === 'function' ? (next as (value: T[K]) => T[K])(current[name]) : next})),
  ];
  const clear = useCallback((retained?: T) => {
    remove(key);
    setSnapshot((current) => current.key === key ? ({...current, value: retained ?? current.initial, dirty: false, restored: false}) : current);
  }, [key]);
  return {value: active.value, field, update, clear, restored: active.restored};
}
