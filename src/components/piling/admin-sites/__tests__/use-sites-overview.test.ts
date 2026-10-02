/**
 * F-R99 №3 и №4: список объектов показывал «Аналитика объектов недоступна (403)»
 * вместо объяснения про права и браузерное «Failed to fetch» при обрыве связи.
 * Проверяем, что причина разбирается и текст — понятный русский.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));

import { useSitesOverview } from '../use-sites-overview';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockAnalytics(analytics: () => Promise<Response>) {
  authFetchMock.mockImplementation((url?: string) =>
    String(url).startsWith('/api/analytics') ? analytics() : Promise.resolve(jsonResponse(200, { crews: [] })));
}

describe('useSitesOverview — понятная причина отказа', () => {
  beforeEach(() => authFetchMock.mockReset());

  it('403 → текст про права, без кода статуса', async () => {
    mockAnalytics(() => Promise.resolve(jsonResponse(403, { error: 'Доступ запрещён' })));

    const { result } = renderHook(() => useSitesOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Нет прав на просмотр объектов. Смените роль или обратитесь к администратору.');
  });

  it('обрыв связи → русский текст, а не «Failed to fetch»', async () => {
    mockAnalytics(() => Promise.reject(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useSitesOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Нет соединения с сервером. Проверьте связь и нажмите «Повторить».');
  });

  it('5xx → сообщение о сбое сервера, без кода статуса', async () => {
    mockAnalytics(() => Promise.resolve(jsonResponse(500, { error: 'Внутренняя ошибка сервера' })));

    const { result } = renderHook(() => useSitesOverview());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Не удалось загрузить объекты. Сервер вернул ошибку.');
  });
});