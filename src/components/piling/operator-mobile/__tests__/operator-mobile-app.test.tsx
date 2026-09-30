/**
 * v1 машиниста: отказ сервера — не обрыв связи (R76, находка 4).
 *
 * Раньше любой сбой загрузки состояния, кроме 401/403, рисовался под заголовком
 * «Нет связи» с советом «восстановите связь». На 500/503 это дезинформация:
 * связь есть, сломан сервер, и чинить его будет механик или администратор, а не
 * машинист с выключенным и включённым Wi-Fi.
 */
import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const api = vi.hoisted(() => ({
  fetchState: vi.fn(),
  sendCommand: vi.fn(),
}));

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
  useOfflineQueue: () => ({queued: [], flush: vi.fn(), retry: vi.fn(), retryFailed: vi.fn(), discard: vi.fn()}),
}));
vi.mock('../operator-type.css', () => ({}));
vi.mock('../operator-concept.css', () => ({}));

import {ApiError} from '@/components/piling/operator-mobile/api';
import {OperatorMobileApp} from '../operator-mobile-app';

beforeEach(() => {
  api.fetchState.mockReset();
  api.sendCommand.mockReset();
});

describe('v1: загрузка состояния не удалась', () => {
  it('503 показывает «Сервер не отвечает» и не велит восстанавливать связь', async () => {
    api.fetchState.mockRejectedValue(new ApiError(503, 'Сервис временно недоступен'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Сервер не отвечает')).toBeInTheDocument();
    expect(screen.getByText(/Связь есть, но сервер временно не работает/)).toBeInTheDocument();
    expect(screen.queryByText(/Восстановите связь и повторите/)).not.toBeInTheDocument();
    // Кнопка повтора остаётся: сервер может подняться сам.
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });

  it('обрыв сети по-прежнему «Нет связи» с советом восстановить связь', async () => {
    api.fetchState.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<OperatorMobileApp />);

    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(screen.getByText(/Восстановите связь и повторите/)).toBeInTheDocument();
    // Текст браузера («Failed to fetch») на экран не попадает — вместо него
    // русская строка (R76, находка 5).
    expect(screen.getByText('Нет связи с сервером. Проверьте интернет и повторите.')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.queryByText('Сервер не отвечает')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeInTheDocument();
  });
});
