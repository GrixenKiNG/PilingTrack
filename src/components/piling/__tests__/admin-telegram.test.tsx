/**
 * F-R120-1 (R120, находка 1): кнопка «Тест» у каждого канала Telegram.
 * Было: `handleTest` не передавал id конфигурации, сервер проверял первую
 * включённую запись — админ у второго бота видел результат первого. Спиннер
 * тоже был один на весь экран. Проверяем, что запрос называет канал своей
 * карточки и крутится только на ней.
 *
 * F-R120-4 (находка 4): отказ сохранения/удаления объясняется человеку — тело
 * ответа (400 с полем, 404) больше не выбрасывается ради «Ошибка сохранения».
 *
 * F-R120-7 (находка 7): сбой чтения списка показывается ошибкой с «Повторить»,
 * а не пустым состоянием «Нет конфигураций Telegram».
 *
 * F-R120-5 (находка 5): ID чата проверяется до отправки — опечатка не
 * сохраняется как рабочий канал.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';

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

/** Открывает диалог создания и заполняет поля (Label не связан с Input). */
const fillCreateDialog = (values: { label: string; token: string; chatId: string }) => {
  fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
  fireEvent.change(screen.getByPlaceholderText('Например: Основной чат'), { target: { value: values.label } });
  fireEvent.change(screen.getByPlaceholderText('123456:ABC-DEF...'), { target: { value: values.token } });
  fireEvent.change(screen.getByPlaceholderText('-1001234567890'), { target: { value: values.chatId } });
};

/** Кнопка отправки в подвале диалога — вторая из двух «Добавить» на экране. */
const submitCreateDialog = () => {
  const buttons = screen.getAllByRole('button', { name: 'Добавить' });
  fireEvent.click(buttons[buttons.length - 1]);
};

describe('AdminTelegram: отказ API объясняется (R120 находка 4)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('400 с полем показывает причину от сервера, а не «Ошибка сохранения»', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(json({ error: 'Некорректные данные', details: [{ field: 'chatId', message: 'String must contain at least 1 character(s)' }] }, 400))
        : Promise.resolve(json({ configs: [] })),
    );
    render(<AdminTelegram />);
    await screen.findByText('Нет конфигураций Telegram');

    fillCreateDialog({ label: 'Ночной чат', token: '123:ABC', chatId: '-100123' });
    submitCreateDialog();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const message = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(message).toContain('Некорректные данные');
    expect(message).toContain('не заполнено');
    expect(message).not.toBe('Ошибка сохранения');
  });

  it('404 при удалении говорит, что запись уже удалена, а не «Ошибка удаления»', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? Promise.resolve(json({ error: 'Config not found' }, 404))
        : Promise.resolve(json({ configs: [config()] })),
    );
    render(<AdminTelegram />);
    await screen.findAllByRole('button', { name: 'Тест' });

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    const confirm = screen.getAllByRole('button', { name: 'Удалить' });
    fireEvent.click(confirm[confirm.length - 1]);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('уже удалили');
    expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('Ошибка удаления');
  });
});

describe('AdminTelegram: сбой чтения списка не выдаётся за пустой список (R120 находка 7)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('403 показывает причину отказа и «Повторить», а не «Нет конфигураций»', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Нет доступа' }, 403));
    render(<AdminTelegram />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа к настройкам Telegram');
    expect(screen.queryByText('Нет конфигураций Telegram')).toBeNull();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });

  it('«Повторить» перечитывает список и показывает каналы', async () => {
    mocks.authFetch
      .mockResolvedValueOnce(json({ error: 'Сбой' }, 500))
      .mockResolvedValueOnce(json({ configs: [config()] }));
    render(<AdminTelegram />);

    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));

    expect(await screen.findAllByRole('button', { name: 'Тест' })).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AdminTelegram: ID чата проверяется до сохранения (R120 находка 5)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('не отправляет на сервер ID чата не в формате числа или @имени', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>(() => {})
        : Promise.resolve(json({ configs: [] })),
    );
    render(<AdminTelegram />);
    await screen.findByText('Нет конфигураций Telegram');

    fillCreateDialog({ label: 'Ночной чат', token: '123:ABC', chatId: 'Chat ID: -100123' });
    submitCreateDialog();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('ID чата');
    expect(posts()).toHaveLength(0);
  });

  it('ID чата числом или @именем уходит на сервер', async () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>(() => {})
        : Promise.resolve(json({ configs: [] })),
    );
    render(<AdminTelegram />);
    await screen.findByText('Нет конфигураций Telegram');

    fillCreateDialog({ label: 'Ночной чат', token: '123:ABC', chatId: '@night_chat' });
    submitCreateDialog();

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(toast.error).not.toHaveBeenCalled();
  });
});