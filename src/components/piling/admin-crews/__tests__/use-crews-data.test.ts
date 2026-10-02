/**
 * R102 (важно №3–№6, №10): тексты отказов в хуке данных бригад.
 *
 * Переключение статуса теряло причину («Ошибка изменения статуса» на любой
 * исход), создание/правка/деактивация показывали английские «Unauthorized»,
 * «CSRF validation failed: …» и браузерный «Failed to fetch», а построчные
 * `details` 400-ответа не читались.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';
import type { CrewDTO } from '@/lib/types';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  authFetch: authFetchMock,
  loadJson: async (url: string) => {
    const res = await authFetchMock(url);
    if (!res.ok) throw new Error(`load failed ${res.status}`);
    return res.json();
  },
  isAbort: (cause: unknown) => cause instanceof Error && cause.name === 'AbortError',
  loadErrorMessage: () => 'Нет соединения с сервером.',
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useCrewsData } from '../use-crews-data';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const crew = {
  id: 'c1',
  name: 'Бригада 1',
  isActive: false,
  assistants: [],
} as unknown as CrewDTO;

function routeCrews(mutation: () => Response | Promise<Response>) {
  authFetchMock.mockImplementation((_url: string, options?: RequestInit) =>
    options?.method && options.method !== 'GET'
      ? Promise.resolve(mutation())
      : Promise.resolve(json({ data: [crew] })),
  );
}

describe('useCrewsData — отказ переключения статуса (F-R102-3)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('409 при активации показывает серверную причину, а не общее «Ошибка изменения статуса»', async () => {
    routeCrews(() => json({ error: 'Установка уже закреплена за активной бригадой «X»' }, 409));

    const { result } = renderHook(() => useCrewsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.toggleActive(crew); });

    expect(toast.error).toHaveBeenCalledWith(
      'Не удалось активировать: Установка уже закреплена за активной бригадой «X»',
    );
  });

  it('обрыв сети при переключении → русский текст, а не «Failed to fetch»', async () => {
    routeCrews(() => Promise.reject(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useCrewsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.toggleActive(crew); });

    expect(toast.error).toHaveBeenCalledWith('Нет соединения с сервером. Проверьте связь и повторите.');
  });
});

describe('useCrewsData — отказы мутаций (F-R102-4,5,6,10)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('401 при создании → «Сессия истекла», а не «Unauthorized»', async () => {
    routeCrews(() => json({ error: 'Unauthorized' }, 401));
    const { result } = renderHook(() => useCrewsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.createCrew({ operatorId: 'o', equipmentId: 'e', siteId: 's', name: 'Б' }))
      .rejects.toThrow('Сессия истекла — войдите снова.');
  });

  it('CSRF-403 при создании → русский текст', async () => {
    routeCrews(() => json({ error: 'CSRF validation failed: origin mismatch' }, 403));
    const { result } = renderHook(() => useCrewsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.createCrew({ operatorId: 'o', equipmentId: 'e', siteId: 's', name: 'Б' }))
      .rejects.toThrow('Запрос отклонён проверкой безопасности. Обновите страницу и повторите.');
  });

  it('400 при создании несёт построчную причину поля', async () => {
    routeCrews(() => json({ error: 'Некорректные данные', details: [{ field: 'name', message: 'Required' }] }, 400));
    const { result } = renderHook(() => useCrewsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.createCrew({ operatorId: 'o', equipmentId: 'e', siteId: 's', name: 'Б' }))
      .rejects.toThrow('Поле name: обязательное поле');
  });

  it('деактивация (DELETE) разбирает отказ так же', async () => {
    routeCrews(() => json({ error: 'Установка занята' }, 409));
    const { result } = renderHook(() => useCrewsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.deleteCrew('c1')).rejects.toThrow('Установка занята');
  });
});
