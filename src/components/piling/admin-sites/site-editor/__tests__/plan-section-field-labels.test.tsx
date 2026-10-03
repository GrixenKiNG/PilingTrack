/**
 * R116 #8: поля строк плана свай и бурения различались только placeholder
 * («шт», «м/шт», «⌀ мм») — скринридер читал «поле ввода 66» без смысла.
 * Подписи строк не показываются визуально, поэтому имя задано через aria-label.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DrillingPlanSection } from '../drilling-plan-section';
import { PilePlanSection } from '../pile-plan-section';
import { PlanSummary } from '../plan-summary';

describe('план свай: поля строки имеют доступное имя (R116 #8)', () => {
  it('марка, количество и длина озвучиваются', () => {
    render(
      <PilePlanSection
        plans={[{ tempId: 't1', pileGradeId: 'pg-1', count: 0, metersPerUnit: 0 }]}
        setPlans={vi.fn()}
        pileGrades={[{ id: 'pg-1', name: 'С 100.30', isActive: true }]}
      />,
    );

    expect(screen.getByLabelText('Марка сваи')).toBeInstanceOf(HTMLButtonElement);
    expect(screen.getByLabelText('Количество, шт')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Длина одной сваи, м/шт')).toBeInstanceOf(HTMLInputElement);
  });
});

describe('план бурения: поля строки имеют доступное имя (R116 #8)', () => {
  it('диаметр, количество и длина озвучиваются', () => {
    render(
      <DrillingPlanSection
        plans={[{ tempId: 'd1', diameter: 0, count: 0, metersPerUnit: 0 }]}
        setPlans={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Диаметр, мм')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Количество, шт')).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText('Длина бурения на единицу, м/шт')).toBeInstanceOf(HTMLInputElement);
  });

  /**
   * R121-7: диаметр бурения принимался без верхней границы, хотя схема
   * маршрута (src/lib/validation-schemas.ts) допускает 0..999. «⌀ 1200»
   * (опечатка) уходил на сервер и возвращал 400.
   */
  it('диаметр ограничен сверху 999, как в схеме маршрута', () => {
    render(
      <DrillingPlanSection
        plans={[{ tempId: 'd1', diameter: 0, count: 0, metersPerUnit: 0 }]}
        setPlans={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Диаметр, мм')).toHaveAttribute('max', '999');
  });
});

/**
 * R129 #1: «Сводка плана» печатала метры через .toFixed(1) — точкой («420.5 м»)
 * вместо запятой (PRODUCT.md:51), рядом с «420,5» на соседнем экране отчётов.
 */
describe('сводка плана: метры с запятой (R129 #1)', () => {
  it('итоги свай и бурения печатаются по-русски', () => {
    render(
      <PlanSummary
        pilePlans={[{ tempId: 't1', pileGradeId: 'pg-1', count: 4, metersPerUnit: 105.125 }]}
        drillingPlans={[{ tempId: 'd1', diameter: 400, count: 2, metersPerUnit: 60.25 }]}
      />,
    );

    expect(screen.getByText('420,5 м')).toBeInstanceOf(HTMLSpanElement);
    expect(screen.getByText('120,5 м')).toBeInstanceOf(HTMLSpanElement);
  });
});

/**
 * R129 #2: строка плана свай и «Итого» печатали метры через .toFixed(1) —
 * точкой и без пробела в разрядах («420.5 м», «3684.0»).
 */
describe('план свай: метры строки и итога с запятой (R129 #2)', () => {
  it('строка и «Итого» печатаются по-русски', () => {
    render(
      <PilePlanSection
        plans={[{ tempId: 't1', pileGradeId: 'pg-1', count: 4, metersPerUnit: 105.125 }]}
        setPlans={vi.fn()}
        pileGrades={[{ id: 'pg-1', name: 'С 100.30', isActive: true }]}
      />,
    );

    expect(screen.getByText('420,5 м')).toBeInstanceOf(HTMLSpanElement);
    expect(screen.getByText('420,5')).toBeInstanceOf(HTMLSpanElement);
  });
});