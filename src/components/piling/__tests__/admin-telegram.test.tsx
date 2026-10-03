/**
 * F-R120-1 (R120, находка 1): кнопка «Тест» у каждого канала Telegram.
 * Было: `handleTest` не передавал id конфигурации, сервер проверял первую
 * включённую запись — админ у второго бота видел результат первого. Спиннер
 * тоже был один на весь экран. Проверяем, что запрос называет канал своей
 * карточки и крутится только на ней.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('framer-motion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  motion: { div: ({ children, initial: _initial, animate: _animate, transition: _transition, ...props }: any) => <div {...props}>{children}</div> },
}));

import { AdminTelegram } from '../admin-telegram';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const config = (over: Record<string, unknown> = {}) => ({
  id: 'cfg-old',
  label: 'Основной чат',
  botTokenHint: 'oken',
  hasBotToken: true,
  chatId: '-100123',
  enabled: true,
  ...over,
});

const posts = () =>
  mocks.authFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

/** Первый (второй по счёту) канал на экране — «свой» для нажатия. */
const testButtons = () => screen.getAllByRole('button', { name: 'Тест' });

const renderWithChannels = async (configs: unknown[]) => {
  mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? new Promise<Response>(() => {})
      : Promise.resolve(json({ configs })),
  );
  render(<AdminTelegram />);
  return await screen.findAllByRole('button', { name: 'Тест' });
};

describe('AdminTelegram: «Тест» проверяет свой канал (R120 находка 1)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('кнопка второй карточки отправляет id этой конфигурации, а не первой', async () => {
    const buttons = await renderWithChannels([
      config({ id: 'cfg-new', label: 'Ночной чат' }),
      config({ id: 'cfg-old', label: 'Основной чат' }),
    ]);

    fireEvent.click(buttons[1]);

    await waitFor(() => expect(posts()).toHaveLength(1));
    const [, init] = posts()[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ configId: 'cfg-old' });
  });

  it('спиннер крутится только на нажатой карточке', async () => {
    const buttons = await renderWithChannels([
      config({ id: 'cfg-new', label: 'Ночной чат' }),
      config({ id: 'cfg-old', label: 'Основной чат' }),
    ]);

    fireEvent.click(buttons[1]);

    await waitFor(() => expect(testButtons()[1].querySelector('.animate-spin')).not.toBeNull());
    expect(testButtons()[0].querySelector('.animate-spin')).toBeNull();

    await act(async () => {});
  });
});