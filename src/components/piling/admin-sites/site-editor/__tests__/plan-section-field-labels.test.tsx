/**
 * R116 #8: поля строк плана свай и бурения различались только placeholder
 * («шт», «м/шт», «⌀ мм») — скринридер читал «поле ввода 66» без смысла.
 * Подписи строк не показываются визуально, поэтому имя задано через aria-label.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DrillingPlanSection } from '../drilling-plan-section';
import { PilePlanSection } from '../pile-plan-section';

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
});