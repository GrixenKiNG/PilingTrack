/**
 * F-QA-403-V7: отказ по роли (403) на экране v7 — это не «нет связи».
 *
 * «Состояние смены недоступно» с кнопкой «Повторить» отправляло помощника
 * машиниста жать кнопку, которую сервер не откроет: роль не исправится повтором.
 * Текст про роль показывается сам по себе (как в `/operator`), без кнопки
 * повтора и без обещания, что записи уйдут позже.
 */
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

const api = vi.hoisted(() => ({fetchState: vi.fn(), sendCommand: vi.fn()}));

vi.mock('@/components/piling/operator-mobile/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/piling/operator-mobile/api')>();
  return {
    ...actual,
    fetchState: api.fetchState,
    sendCommand: api.sendCommand,
    currentPosition: vi.fn(async () => null),
  };
});
vi.mock('@/components/piling/operator-mobile/use-offline-queue', () => ({
  useOfflineQueue: () => ({queued: [], flush: vi.fn(), retry: vi.fn(), discard: vi.fn()}),
}));
vi.mock('../../operator-concept.css', () => ({}));

import {ApiError} from '@/components/piling/operator-mobile/api';
import {OperatorV7App} from '../operator-v7-app';
import {workStateFixture} from '../../__tests__/fixtures';
import {JournalScreen} from '../v7-screens';

describe('v7: поправка выработки', () => {
  it.each(['WORK', 'CLOSING', 'CLOSED'] as const)('журнал %s разрешает поправку только до закрытия', (phase) => {
    render(<JournalScreen state={workStateFixture({phase, entries: [{id: 'entry-1', kind: 'PILES', label: 'Сваи',
      value: 2, meters: 12, occurredAt: '2026-09-20T08:00:00.000Z', corrections: []}]})} onCorrect={vi.fn()} />);
    if (phase === 'CLOSED') expect(screen.queryByRole('button', {name: 'Поправить'})).not.toBeInTheDocument();
    else expect(screen.getByRole('button', {name: 'Поправить'})).toBeInTheDocument();
  });
  it('после принятия держит форму занятой до обновления серверного итога', async () => {
    const state = workStateFixture({operator: {id: 'operator', name: 'Машинист'}, entries: [{
      id: 'entry-1', kind: 'DOWNTIME', label: 'Ожидание', value: 2, meters: null,
      occurredAt: '2026-09-20T08:00:00.000Z', corrections: [],
    }]});
    let finishReload!: (value: typeof state) => void;
    api.fetchState.mockReset().mockResolvedValueOnce(state).mockImplementationOnce(() => new Promise(resolve => {finishReload = resolve;}));
    api.sendCommand.mockReset().mockResolvedValue(undefined);
    render(<OperatorV7App />);
    fireEvent.click(await screen.findByRole('button', {name: 'Поправить'}));
    const form = within(screen.getByRole('group', {name: 'Поправка записи'}));
    fireEvent.change(form.getByLabelText('Сколько часов простоя было на самом деле'), {target: {value: '1'}});
    fireEvent.change(form.getByLabelText('Что случилось'), {target: {value: 'Ошибка ввода'}});
    fireEvent.click(form.getByRole('button', {name: 'Записать поправку'}));
    await waitFor(() => expect(api.fetchState).toHaveBeenCalledTimes(2));
    expect(form.getByLabelText('Что случилось')).toBeDisabled();
    finishReload({...state, entries: [{...state.entries[0], value: 1, corrections: [{delta: -1, note: 'Ошибка ввода', at: '2026-09-20T09:00:00.000Z'}]}]});
    await waitFor(() => expect(screen.queryByRole('group', {name: 'Поправка записи'})).not.toBeInTheDocument());
    expect(screen.getByText('1 ч')).toBeInTheDocument();
    expect(screen.getByText('Есть поправки: 1')).toBeInTheDocument();
  });
  it('при 409 оставляет ввод и причину внутри формы, повторяет тот же ключ команды', async () => {
    api.fetchState.mockReset().mockResolvedValue(workStateFixture({operator: {id: 'operator', name: 'Машинист'}, entries: [{
      id: 'entry-1', kind: 'DOWNTIME', label: 'Ожидание', value: 2, meters: null,
      occurredAt: '2026-09-20T08:00:00.000Z', corrections: [],
    }]}));
    api.sendCommand.mockReset().mockRejectedValueOnce(new ApiError(409, 'Смена уже закрыта')).mockResolvedValue(undefined);
    render(<OperatorV7App />);
    fireEvent.click(await screen.findByRole('button', {name: 'Поправить'}));
    const form = within(screen.getByRole('group', {name: 'Поправка записи'}));
    fireEvent.change(form.getByLabelText('Сколько часов простоя было на самом деле'), {target: {value: '1,5'}});
    fireEvent.change(form.getByLabelText('Что случилось'), {target: {value: 'Ошибка ввода'}});
    fireEvent.click(form.getByRole('button', {name: 'Записать поправку'}));
    await waitFor(() => expect(form.getByRole('alert')).toHaveTextContent('Смена уже закрыта'));
    expect(form.getByLabelText('Сколько часов простоя было на самом деле')).toHaveValue('1,5');
    expect(api.sendCommand).toHaveBeenLastCalledWith({command: 'correct-production', clientCommandId: expect.any(String),
      shiftId: 'shift-1', entryId: 'entry-1', kind: 'DOWNTIME', actual: 1.5, reason: 'Ошибка ввода'});
    const first = api.sendCommand.mock.calls[0][0];
    fireEvent.click(form.getByRole('button', {name: 'Записать поправку'}));
    await waitFor(() => expect(screen.queryByRole('group', {name: 'Поправка записи'})).not.toBeInTheDocument());
    expect(api.sendCommand.mock.calls[1][0]).toEqual(first);
  });
});

describe('отказ по роли на экране v7', () => {
  it('после 503 текстовый повтор открывает восстановленную смену', async () => {
    api.fetchState.mockReset().mockRejectedValueOnce(new ApiError(503, 'Сервис временно недоступен'))
      .mockResolvedValue(workStateFixture({operator: {id: 'operator', name: 'Машинист'}}));
    render(<OperatorV7App />);
    expect(await screen.findByText('Состояние смены недоступно')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    expect(await screen.findByRole('button', {name: 'Добавить сваю'})).toBeInTheDocument();
    expect(screen.queryByText('Состояние смены недоступно')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
    expect(api.fetchState).toHaveBeenCalledTimes(2);
  });
  it('403 — текст про роль, без повтора и обещания отправки', async () => {
    api.fetchState.mockRejectedValueOnce(new ApiError(403, 'Экран доступен только машинисту'));
    render(<OperatorV7App />);

    await waitFor(() => expect(screen.getByText('Экран доступен только машинисту')).toBeInTheDocument());
    expect(screen.queryByRole('button', {name: 'Повторить'})).not.toBeInTheDocument();
    expect(screen.queryByText(/уйдут|отправим|позже|при связи/)).not.toBeInTheDocument();
  });

  it('сетевой сбой — прежний текст про недоступность состояния и повтор', async () => {
    api.fetchState.mockRejectedValueOnce(new Error('Failed to fetch'));
    render(<OperatorV7App />);

    await waitFor(() => expect(screen.getByText('Состояние смены недоступно')).toBeInTheDocument());
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });
});
