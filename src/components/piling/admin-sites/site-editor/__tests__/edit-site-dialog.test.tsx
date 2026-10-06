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

  /**
   * F-R126-3: диалог «Редактировать объект» выше короткого экрана (при 375×568
   * высота 578 px, `top = −5`, крестик закрытия уходит за кадр) — у DialogContent
   * не было ни ограничения высоты, ни прокрутки. Теперь `max-h-[90vh]` +
   * `overflow-y-auto`: содержимое влезает и скроллится.
   */
  it('диалог ограничен по высоте и прокручивается на коротком экране (F-R126-3)', async () => {
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ site: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={vi.fn()} loadingPileGrades={false} pileGrades={[]} onSave={vi.fn()}
    />);

    const dialog = (await screen.findByText('Редактировать объект')).closest('[data-slot="dialog-content"]');
    expect(dialog).toHaveClass('max-h-[90vh]', 'overflow-y-auto');
  });

  /**
   * F-R126-17: на 375 px диалог растягивался на всю ширину — `max-w-lg` перебивал
   * базовый `max-w-[calc(100%-2rem)]` у DialogContent, и отступы 16 px по краям
   * терялись. Ширина ограничена только с sm, на телефоне работает база.
   */
  it('на телефоне оставляет отступы по краям, а не растягивается на всю ширину (F-R126-17)', async () => {
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ site: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={vi.fn()} loadingPileGrades={false} pileGrades={[]} onSave={vi.fn()}
    />);

    const dialog = (await screen.findByText('Редактировать объект')).closest('[data-slot="dialog-content"]');
    expect(dialog).toHaveClass('sm:max-w-lg');
    expect(dialog).not.toHaveClass('max-w-lg');
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

/**
 * F-R132-3: «Редактировать объект» закрывался по Esc, клику вне окна и «Отмена»
 * без вопроса — правки названия, координат и планов терялись молча. Пока форма
 * «грязная» (снимок загруженного состояния против текущего), закрытие спрашивает
 * подтверждение.
 */
describe('EditSiteDialog — защита несохранённых правок (F-R132-3)', () => {
  function renderDialog(onOpenChange = vi.fn()) {
    authFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ site: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<EditSiteDialog
      site={{ id: 's1', name: 'Объект 1', isActive: true, plannedPiles: 1, plannedDrilling: 1 }}
      open onOpenChange={onOpenChange} loadingPileGrades={false} pileGrades={[]} onSave={vi.fn()}
    />);
    return onOpenChange;
  }

  it('изменённое название — «Отмена» спрашивает и при отказе не закрывает', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const onOpenChange = renderDialog();

    fireEvent.change(await screen.findByLabelText('Название объекта'), { target: { value: 'Объект 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('без правок «Отмена» закрывает без вопроса', async () => {
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal('confirm', confirmMock);
    const onOpenChange = renderDialog();

    await screen.findByLabelText('Название объекта');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    expect(confirmMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    vi.unstubAllGlobals();
  });
});
