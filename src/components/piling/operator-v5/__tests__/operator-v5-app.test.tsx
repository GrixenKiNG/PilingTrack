import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
// Экран тянет рабочий обзор оператора, а тот — стили PostCSS; в тесте они не нужны.
vi.mock('@/components/piling/operator-mobile/operator-concept.css', () => ({}));
import {CloseScreen, WorkScreen} from '../operator-v5-app';

/**
 * F-R43-1: смену нельзя закрыть, пока на телефоне лежат неотправленные записи.
 *
 * Закрытая смена отвечает отложенной выработке 409 «Смена уже закрыта», и в
 * отчёт она не попадает: сначала очередь, потом закрытие.
 */
const ready = {
  phase: 'CLOSING',
  receipt: null,
  production: {
    piles: {count: 12, meters: 168},
    drilling: {count: 0, meters: 0},
    downtimeHours: 0,
  },
} as unknown as OperatorMobileState;

describe('закрытие смены v5 при непустой очереди', () => {
  it('держит закрытие и предлагает отправить записи', () => {
    const onClose = vi.fn();
    const onFlush = vi.fn();
    render(<CloseScreen state={ready} busy={false} onClose={onClose} unsent={2} onFlush={onFlush} />);

    expect(screen.getByText('Сначала отправьте записи с телефона: 2 не отправлено')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Закрыть смену'})).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: 'Отправить сейчас'}));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('закрывает смену, когда очередь пуста', () => {
    const onClose = vi.fn();
    render(<CloseScreen state={ready} busy={false} onClose={onClose} unsent={0} onFlush={() => {}} />);

    expect(screen.queryByText(/Сначала отправьте записи/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Закрыть смену'}));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/**
 * F-R43-3a: форма выработки чистится только по подтверждению сервера.
 *
 * Отказ 400/409 приходит уже после отправки: если очистить поля сразу, число,
 * которое машинист набрал в перчатке, пропадёт вместе с текстом отказа. Пока
 * состояние показывает, что работа разрешена и допуск пройден, обзор позволяет
 * открыть форму свай.
 */
const working = {
  phase: 'WORK',
  productionDate: '2026-09-27',
  shift: {id: 'shift-1', productionDate: '2026-09-27'},
  assignment: {equipmentId: 'eq-1', equipmentName: 'Liebherr LRH 100', siteName: 'Площадка'},
  permit: {allowed: true, blocks: []},
  identity: {
    ppe: {confirmed: true, missing: []},
    briefing: {ok: true},
    knowledge: {ok: true},
    documents: [],
  },
  checklists: [
    {stage: 'PRESHIFT_INSPECTION', done: true, period: null},
    {stage: 'SITE_READY', done: true, period: null},
    {stage: 'EO_BEFORE', done: true, period: null},
  ],
  dictionaries: {
    pileGrades: [{id: 'grade-1', name: 'С 20-35', lengthMm: 6000}],
    drillingTypes: [],
    downtimeReasons: [],
  },
  production: {
    piles: {count: 0, meters: 0},
    drilling: {count: 0, meters: 0},
    downtimeHours: 0,
  },
  entries: [],
  warnings: [],
} as unknown as OperatorMobileState;

/** Экран работы без формы. */
function renderWork(onLog: (entry: unknown) => Promise<boolean>) {
  return render(<WorkScreen
    state={working}
    busy={false}
    onLog={onLog as never}
    onFinish={() => {}}
    onOpenSafety={() => {}}
    onIncident={() => {}}
  />);
}

/** Открывает форму свай и вводит «12 шт». Возвращает поле числа. */
function fillPiles(container: HTMLElement) {
  fireEvent.click(screen.getByRole('button', {name: 'Добавить сваю'}));
  fireEvent.change(container.querySelector('select') as HTMLSelectElement, {target: {value: 'grade-1'}});
  const count = container.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
  fireEvent.change(count, {target: {value: '12'}});
  return count;
}

describe('запись выработки v5 и отказ сервера', () => {
  it('оставляет введённое число, когда сервер отказал', async () => {
    const onLog = vi.fn().mockResolvedValue(false);
    const {container} = renderWork(onLog);
    const count = fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(1));
    expect(count.value).toBe('12');
  });

  it('чистит поле, когда запись принята', async () => {
    const onLog = vi.fn().mockResolvedValue(true);
    const {container} = renderWork(onLog);
    const count = fillPiles(container);

    fireEvent.click(screen.getByRole('button', {name: 'Записать'}));

    await waitFor(() => expect(onLog).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(count.value).toBe(''));
  });
});