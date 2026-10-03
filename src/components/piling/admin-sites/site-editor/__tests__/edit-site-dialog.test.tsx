import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  /**
   * R121-6: «Название объекта» не имело maxLength, а createSiteSchema
   * (src/lib/validation-schemas.ts) ограничивает имя 200 символами. Длинное
   * название уходило на сервер и возвращало 400 без имени поля.
   */
  it('название объекта ограничено длиной 200, как в схеме маршрута', async () => {
    authFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ site: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={vi.fn()} loadingPileGrades={false} pileGrades={[]} onSave={vi.fn()}
    />);

    expect(await screen.findByLabelText('Название объекта')).toHaveAttribute('maxLength', '200');
  });

  it('перед сохранением без плана показывает подробное подтверждение (F-R113-14)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', confirm);
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      site: { pilePlans: [{ id: 'p1', pileGradeId: 'grade-1', count: 0, metersPerUnit: 10 }], drillingPlans: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={vi.fn()} loadingPileGrades={false} pileGrades={[]} onSave={onSave}
    />);

    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Все текущие строки плана \(сваи: 1, бурение: 0\) будут удалены, а плановые цифры обнулены/);
    expect(onSave).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить без плана' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith('s1', 'Объект 1', true, expect.any(Array), expect.any(Array), {
      latitude: null,
      longitude: null,
    });
    expect(confirm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
