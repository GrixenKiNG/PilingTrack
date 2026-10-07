/**
 * W52: ветки ошибок хука `useFleet` (внесены этой веткой, класс F-R112-1)
 * не покрывались — тестов у файла не было вовсе. Хук кормит «Установки» и
 * мониторинг, и неверная реакция на истёкшую сессию, ответ сервера и обрыв
 * связи приводила бы к молчаливо пустому парку.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));

import { useFleet } from '../use-fleet';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const snapshot = { totals: { totalEquipment: 1, equipment: [] } };

describe('useFleet — снимок парка (W52)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('успешный ответ кладёт снимок и снимает загрузку', async () => {
    mocks.authFetch.mockResolvedValue(json(snapshot));

    const { result } = renderHook(() => useFleet());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.snapshot).toEqual(snapshot);
  });

  it('401 → «Сессия истекла — войдите снова.», парк не подставляется', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Unauthorized' }, 401));

    const { result } = renderHook(() => useFleet());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Сессия истекла — войдите снова.');
    expect(result.current.snapshot).toBeNull();
  });

  it('не-ok ответ → «Сервер вернул <код>»', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Ошибка сервера' }, 500));

    const { result } = renderHook(() => useFleet());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Сервер вернул 500');
  });

  it('AbortError не показывается как ошибка', async () => {
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    mocks.authFetch.mockRejectedValue(abort);

    const { result } = renderHook(() => useFleet());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.snapshot).toBeNull();
  });

  it('обрыв сети → русский текст, а не «Failed to fetch»', async () => {
    mocks.authFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useFleet());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Нет соединения с сервером. Проверьте связь и повторите.');
  });

  it('refetch повторяет запрос', async () => {
    mocks.authFetch.mockResolvedValue(json(snapshot));

    const { result } = renderHook(() => useFleet());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mocks.authFetch.mock.calls.length;

    await act(async () => { await result.current.refetch(); });

    expect(mocks.authFetch.mock.calls.length).toBe(before + 1);
  });
});
