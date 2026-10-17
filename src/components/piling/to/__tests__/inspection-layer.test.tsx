import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectionLayer, inspectionIdFromHref } from '../inspection-layer';

const runInspection = vi.hoisted(() => vi.fn());

vi.mock('@/components/piling/inspections/run-inspection', () => ({
  RunInspection: (props: { inspectionId: string; onExit?: () => void }) => {
    runInspection(props);
    return <button type="button" onClick={props.onExit}>Осмотр {props.inspectionId} (внутри экрана)</button>;
  },
}));

afterEach(() => {
  cleanup();
  runInspection.mockClear();
});

function renderLayer() {
  return render(
    <InspectionLayer>
      <a href="/inspections/insp-1">Осмотр ЕО</a>
      <a href="/inspections/insp-2" target="_blank" rel="noopener noreferrer">Открыть этот осмотр</a>
      <a href="/inspections/new?equipmentId=eq-1">Создать осмотр</a>
      <a href="/admin/maintenance/rec-1">Заявка ТО</a>
    </InspectionLayer>,
  );
}

describe('inspectionIdFromHref — какие ссылки открываются внутри экрана', () => {
  it.each([
    ['/inspections/insp-1', 'insp-1'],
    ['/inspections/cmu7gfdof002o6kw5l0igl85c', 'cmu7gfdof002o6kw5l0igl85c'],
  ])('%s → осмотр %s', (href, id) => {
    expect(inspectionIdFromHref(href)).toBe(id);
  });

  it.each([
    ['/inspections'],
    ['/inspections/'],
    ['/inspections/new'],
    ['/inspections/new?equipmentId=eq-1'],
    ['/inspections/insp-1/photos'],
    ['/admin/maintenance/rec-1'],
    ['https://example.com/inspections/insp-1'],
    [null],
  ])('%s — обычная ссылка, не перехватывается', (href) => {
    expect(inspectionIdFromHref(href)).toBeNull();
  });
});

describe('InspectionLayer — осмотр открывается поверх экрана', () => {
  it('клик по ссылке на осмотр открывает осмотр внутри экрана, а не переходит по ссылке', () => {
    renderLayer();

    const notPrevented = fireEvent.click(screen.getByText('Осмотр ЕО'));

    expect(notPrevented).toBe(false); // переход браузера отменён
    expect(screen.getByRole('button', { name: 'Осмотр insp-1 (внутри экрана)' })).toBeTruthy();
    expect(runInspection).toHaveBeenCalledWith(expect.objectContaining({ inspectionId: 'insp-1' }));
  });

  it('ссылка «в новой вкладке» на осмотр тоже открывает его внутри экрана', () => {
    renderLayer();

    fireEvent.click(screen.getByText('Открыть этот осмотр'));

    expect(screen.getByRole('button', { name: 'Осмотр insp-2 (внутри экрана)' })).toBeTruthy();
  });

  it('«назад» из осмотра закрывает слой и возвращает на экран', () => {
    renderLayer();
    fireEvent.click(screen.getByText('Осмотр ЕО'));

    fireEvent.click(screen.getByRole('button', { name: 'Осмотр insp-1 (внутри экрана)' }));

    expect(screen.queryByRole('button', { name: /внутри экрана/ })).toBeNull();
    expect(screen.getByText('Осмотр ЕО')).toBeTruthy();
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['средняя кнопка', { button: 1 }],
  ])('%s + клик оставляет обычное поведение ссылки (новая вкладка)', (_name, init) => {
    renderLayer();

    const notPrevented = fireEvent.click(screen.getByText('Осмотр ЕО'), init);

    expect(notPrevented).toBe(true);
    expect(runInspection).not.toHaveBeenCalled();
  });

  it('создание осмотра и другие ссылки не перехватываются', () => {
    renderLayer();

    expect(fireEvent.click(screen.getByText('Создать осмотр'))).toBe(true);
    expect(fireEvent.click(screen.getByText('Заявка ТО'))).toBe(true);
    expect(runInspection).not.toHaveBeenCalled();
  });
});
