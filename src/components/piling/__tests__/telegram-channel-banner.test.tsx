/**
 * Баннер «Telegram выключен»: 403/401 от Telegram сами выключают канал
 * (`recordTelegramFailure`), после чего тревоги и PDF уходят в повторы и DLQ, а
 * сообщить об этом некому. Баннер виден админу на главной и в очереди
 * недоставленных и включает канал одним нажатием.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn(), role: 'ADMIN' as string | undefined }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (s: { currentUser: { role?: string } | null }) => unknown) =>
    selector({ currentUser: mocks.role ? { role: mocks.role } : null }),
}));

import { TelegramChannelBanner } from '../telegram-channel-banner';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const config = (over: Record<string, unknown> = {}) => ({
  id: 'cfg-1',
  label: 'Основной чат — Бот заблокирован — разблокируйте его в чате',
  botTokenHint: 'oken',
  hasBotToken: true,
  chatId: '-100123',
  enabled: false,
  ...over,
});

const puts = () =>
  mocks.authFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');

describe('TelegramChannelBanner', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    mocks.role = 'ADMIN';
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('показывает баннер, когда настроенные каналы все выключены', async () => {
    mocks.authFetch.mockResolvedValue(json({ configs: [config()] }));
    render(<TelegramChannelBanner />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Telegram-уведомления не доставляются');
    expect(screen.getByRole('alert')).toHaveTextContent('Бот заблокирован');
    expect(screen.getByRole('link', { name: /Настройки Telegram/ })).toHaveAttribute('href', '/admin/telegram');
  });

  it('молчит, если хотя бы один канал включён', async () => {
    mocks.authFetch.mockResolvedValue(json({ configs: [config(), config({ id: 'cfg-2', enabled: true })] }));
    render(<TelegramChannelBanner />);

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('молчит, если каналов нет вовсе', async () => {
    mocks.authFetch.mockResolvedValue(json({ configs: [] }));
    render(<TelegramChannelBanner />);

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('не ходит на сервер и ничего не показывает не-админу', async () => {
    mocks.role = 'DISPATCHER';
    render(<TelegramChannelBanner />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.authFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('молчит при отказе чтения: баннер не должен ломать страницу', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Forbidden' }, 403));
    render(<TelegramChannelBanner />);

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('«Включить» шлёт PUT с id канала и убирает баннер', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? json({ config: config({ enabled: true }) }) : json({ configs: [config()] })),
    );
    render(<TelegramChannelBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Включить' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    const [url, init] = puts()[0] as [string, RequestInit];
    expect(url).toBe('/api/telegram/configs');
    expect(JSON.parse(String(init.body))).toEqual({ id: 'cfg-1', enabled: true });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(toast.success).toHaveBeenCalled();
  });

  it('при отказе включения баннер остаётся и показывается ошибка', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? json({ error: 'fail' }, 500) : json({ configs: [config()] })),
    );
    render(<TelegramChannelBanner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Включить' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
