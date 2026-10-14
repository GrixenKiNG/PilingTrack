'use client';

import { Children, useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Доли трёх колонок. Это веса, а не проценты: сетка раскладывает их через `fr`. */
export type ColumnWeights = readonly [number, number, number];

/** Пропорции утверждённого макета центра готовности: 0.9 / 1.45 / 1. */
export const COLUMN_DEFAULTS: ColumnWeights = [0.9, 1.45, 1];

/** Колонка не уже этой доли: при 0.9 / 1.45 / 1 это около 15% ширины. */
const MIN_WEIGHT = 0.5;
/** Ширина разделителя в пикселях. Она же заменяет промежуток между колонками. */
const SPLITTER_PX = 12;
const KEY_STEP = 0.05;

/**
 * Двигает границу `index` (0 — между первой и второй колонкой, 1 — между
 * второй и третьей) на `delta` весов. Соседи обмениваются шириной, сумма весов
 * не меняется, ни одна колонка не становится уже `min`.
 */
export function resizeWeights(weights: ColumnWeights, index: 0 | 1, delta: number, min = MIN_WEIGHT): ColumnWeights {
  const next: [number, number, number] = [weights[0], weights[1], weights[2]];
  const a = index;
  const b = index + 1;
  const pair = next[a] + next[b];
  const left = Math.min(pair - min, Math.max(min, next[a] + delta));
  next[a] = left;
  next[b] = pair - left;
  return next;
}

function readStored(key: string): ColumnWeights | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [a, b, c] = parsed;
    const valid = [a, b, c].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= MIN_WEIGHT);
    return valid ? [a, b, c] : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, weights: ColumnWeights | null) {
  try {
    if (weights) localStorage.setItem(key, JSON.stringify(weights));
    else localStorage.removeItem(key);
  } catch {
    // Приватный режим или переполнение: размеры просто не запомнятся.
  }
}

const sum = (weights: ColumnWeights) => weights[0] + weights[1] + weights[2];

/**
 * Три колонки с перетаскиваемыми границами. Раскладка работает только на
 * широком экране (xl): на узком колонки идут друг под другом, как раньше, и
 * разделителей нет.
 *
 * Размеры помнятся в браузере по `storageKey`. Двойной щелчок по разделителю
 * возвращает исходные пропорции. Граница двигается и с клавиатуры: стрелки
 * влево и вправо, с Shift — шаг крупнее.
 */
export function ResizableColumns({ storageKey, className, children }: {
  storageKey: string;
  className?: string;
  children: ReactNode;
}) {
  const columns = Children.toArray(children);
  const [weights, setWeights] = useState<ColumnWeights>(COLUMN_DEFAULTS);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: 0 | 1; startX: number; startWeights: ColumnWeights; perPx: number } | null>(null);

  useEffect(() => {
    const stored = readStored(storageKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- размеры читаются из localStorage один раз после монтирования, чтобы не расходиться с серверной разметкой
    if (stored) setWeights(stored);
  }, [storageKey]);

  const commit = useCallback((next: ColumnWeights) => {
    setWeights(next);
    writeStored(storageKey, next);
  }, [storageKey]);

  const onPointerDown = (index: 0 | 1) => (event: PointerEvent<HTMLDivElement>) => {
    const width = containerRef.current?.getBoundingClientRect().width ?? 0;
    const free = width - 2 * SPLITTER_PX;
    if (free <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index, startX: event.clientX, startWeights: weights, perPx: sum(weights) / free };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    setWeights(resizeWeights(state.startWeights, state.index, (event.clientX - state.startX) * state.perPx));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    writeStored(storageKey, weights);
  };

  const onKeyDown = (index: 0 | 1) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (event.shiftKey ? 4 : 1) * KEY_STEP;
    commit(resizeWeights(weights, index, event.key === 'ArrowRight' ? step : -step));
  };

  const reset = () => {
    setWeights(COLUMN_DEFAULTS);
    writeStored(storageKey, null);
  };

  const total = sum(weights);
  const template = `minmax(0,${weights[0]}fr) ${SPLITTER_PX}px minmax(0,${weights[1]}fr) ${SPLITTER_PX}px minmax(0,${weights[2]}fr)`;

  const splitter = (index: 0 | 1, label: string) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round((weights[index] / total) * 100)}
      aria-valuemin={Math.round((MIN_WEIGHT / total) * 100)}
      aria-valuemax={Math.round(((total - MIN_WEIGHT) / total) * 100)}
      tabIndex={0}
      title="Потяните, чтобы изменить ширину. Двойной щелчок — вернуть как было"
      onPointerDown={onPointerDown(index)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown(index)}
      onDoubleClick={reset}
      className="group hidden cursor-col-resize touch-none select-none items-stretch justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex"
    >
      <span className="my-1 w-0.5 rounded-full bg-border transition-colors group-hover:bg-signal group-focus-visible:bg-signal group-active:bg-signal" />
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={cn('xl:gap-x-0 xl:[grid-template-columns:var(--readiness-columns)]', className)}
      style={{ ['--readiness-columns' as string]: template }}
    >
      {columns[0]}
      {splitter(0, 'Граница между левой и средней колонкой')}
      {columns[1]}
      {splitter(1, 'Граница между средней и правой колонкой')}
      {columns[2]}
    </div>
  );
}
