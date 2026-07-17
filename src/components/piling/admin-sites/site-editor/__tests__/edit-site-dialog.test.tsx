import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ authFetch }));
vi.mock('../pile-plan-section', () => ({ PilePlanSection: () => <div /> }));
vi.mock('../drilling-plan-section', () => ({ DrillingPlanSection: () => <div /> }));
vi.mock('../plan-summary', () => ({ PlanSummary: () => <div /> }));

import { EditSiteDialog } from '../edit-site-dialog';

describe('EditSiteDialog', () => {
  it('shows a retryable error and disables save when plans fail to load', async () => {
    authFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={vi.fn()} loadingPileGrades={false} pileGrades={[]} onSave={vi.fn()}
    />);
    await waitFor(() => expect(screen.getByText('Не удалось загрузить планы объекта')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

// Guard инцидента 2026-07-17: сохранение объекта с опустевшим планом стёрло
// план «Новгорода» (7000 свай / 72000 м) без предупреждения.
import { planWipeRequiresConfirm } from '../plan-helpers';

describe('planWipeRequiresConfirm', () => {
  const pile = (count: number, pileGradeId = 'pg1') => ({ tempId: 't', pileGradeId, count, metersPerUnit: 10 });
  const drill = (count: number) => ({ tempId: 't', diameter: 350, count, metersPerUnit: 12 });

  it('требует подтверждения, когда существующий план свай опустел', () => {
    expect(planWipeRequiresConfirm(2, 0, [], [])).toBe(true);
  });

  it('строки без марки или с нулевым количеством не считаются планом', () => {
    expect(planWipeRequiresConfirm(2, 1, [pile(0), pile(5, '')], [drill(0)])).toBe(true);
  });

  it('не мешает обычному сохранению с планом', () => {
    expect(planWipeRequiresConfirm(2, 1, [pile(6000)], [drill(6000)])).toBe(false);
  });

  it('не спрашивает, если плана и не было', () => {
    expect(planWipeRequiresConfirm(0, 0, [], [])).toBe(false);
  });
});
