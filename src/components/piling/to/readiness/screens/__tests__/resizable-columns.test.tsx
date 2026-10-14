/**
 * Три колонки центра готовности меняют ширину перетаскиванием разделителей.
 * Здесь проверяется арифметика долей и работа с клавиатуры: перетаскивание мышью
 * считает ту же функцию `resizeWeights`, а измерять пиксели в тестовой среде нечем.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  COLUMN_DEFAULTS, ResizableColumns, resizeWeights, type ColumnWeights,
} from '../resizable-columns';

const STORAGE_KEY = 'test-columns';

describe('resizeWeights', () => {
  it('переносит ширину между соседними колонками и сохраняет сумму', () => {
    const next = resizeWeights([1, 1, 1], 0, 0.2);
    expect(next[0]).toBeCloseTo(1.2);
    expect(next[1]).toBeCloseTo(0.8);
    expect(next[2]).toBe(1);
    expect(next[0] + next[1] + next[2]).toBeCloseTo(3);
  });

  it('второй разделитель двигает среднюю и правую колонки', () => {
    const next = resizeWeights([1, 1, 1], 1, -0.3);
    expect(next[0]).toBe(1);
    expect(next[1]).toBeCloseTo(0.7);
    expect(next[2]).toBeCloseTo(1.3);
  });

  it('не даёт колонке стать уже минимума и не меняет сумму', () => {
    const next = resizeWeights([1, 1, 1], 0, 5, 0.5);
    expect(next[1]).toBeCloseTo(0.5);
    expect(next[0]).toBeCloseTo(1.5);
    expect(next[0] + next[1] + next[2]).toBeCloseTo(3);
    const left = resizeWeights([1, 1, 1], 0, -5, 0.5);
    expect(left[0]).toBeCloseTo(0.5);
    expect(left[1]).toBeCloseTo(1.5);
  });
});

describe('ResizableColumns', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const renderColumns = () => render(
    <ResizableColumns storageKey={STORAGE_KEY} className="grid">
      <section>Левая</section>
      <div>Средняя</div>
      <aside>Правая</aside>
    </ResizableColumns>,
  );

  it('рисует два разделителя между тремя колонками', () => {
    renderColumns();
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByText('Левая')).toBeInTheDocument();
    expect(screen.getByText('Правая')).toBeInTheDocument();
  });

  it('стрелки двигают границу, а результат переживает перезагрузку', () => {
    const { unmount } = renderColumns();
    const [first] = screen.getAllByRole('separator');
    const before = Number(first.getAttribute('aria-valuenow'));
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const after = Number(first.getAttribute('aria-valuenow'));
    expect(after).toBeGreaterThan(before);

    unmount();
    renderColumns();
    const [restored] = screen.getAllByRole('separator');
    expect(Number(restored.getAttribute('aria-valuenow'))).toBe(after);
  });

  it('двойной щелчок возвращает исходные доли', () => {
    renderColumns();
    const [first] = screen.getAllByRole('separator');
    const initial = Number(first.getAttribute('aria-valuenow'));
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.doubleClick(first);
    expect(Number(first.getAttribute('aria-valuenow'))).toBe(initial);
  });

  it('при испорченном сохранённом значении берёт исходные доли', () => {
    localStorage.setItem(STORAGE_KEY, '{"oops"');
    renderColumns();
    const defaults: ColumnWeights = COLUMN_DEFAULTS;
    const total = defaults[0] + defaults[1] + defaults[2];
    const [first] = screen.getAllByRole('separator');
    expect(Number(first.getAttribute('aria-valuenow'))).toBe(Math.round((defaults[0] / total) * 100));
  });
});
