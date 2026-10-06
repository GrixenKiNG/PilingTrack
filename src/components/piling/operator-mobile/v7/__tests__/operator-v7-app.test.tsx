/**
 * F-QA-403-V7: отказ по роли (403) на экране v7 — это не «нет связи».
 *
 * «Состояние смены недоступно» с кнопкой «Повторить» отправляло помощника
 * машиниста жать кнопку, которую сервер не откроет: роль не исправится повтором.
 * Текст про роль показывается сам по себе (как в `/operator`), без кнопки
 * повтора и без обещания, что записи уйдут позже.
 */
import {render, screen, waitFor} from '@testing-library/react';
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

describe('отказ по роли на экране v7', () => {
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
