/**
 * extractApiError — surfaces the server's error message (finding #3), the
 * per-field `details` (finding #11) and Russian wording for the English
 * 401/CSRF-403 bodies (finding #12).
 *
 * Deactivating a site with unfinished draft reports returns a 409 with a
 * helpful Russian message. The handlers must show it instead of a generic
 * "Ошибка".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { catchText, extractApiError, useSiteMutations } from '../use-site-mutations';
import { deactivateDescription } from '../site-deactivate';

function res(json: () => Promise<unknown>): Response {
  return { json } as unknown as Response;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('extractApiError', () => {
  it('returns the server error field when present', async () => {
    const message = await extractApiError(
      res(async () => ({ error: 'Невозможно деактивировать объект: 2 незавершённых отчётов.' })),
      'fallback',
    );
    expect(message).toBe('Невозможно деактивировать объект: 2 незавершённых отчётов.');
  });

  it('returns the fallback when the body has no error field', async () => {
    const message = await extractApiError(res(async () => ({ ok: false })), 'fallback');
    expect(message).toBe('fallback');
  });

  it('returns the fallback when the body is not JSON', async () => {
    const message = await extractApiError(res(async () => { throw new Error('not json'); }), 'fallback');
    expect(message).toBe('fallback');
  });
});

describe('extractApiError — статус и построчные ошибки (находки 11 и 12)', () => {
  it('401 → русское сообщение об истёкшей сессии вместо «Unauthorized»', async () => {
    const message = await extractApiError(jsonResponse(401, { error: 'Unauthorized' }), 'fallback');
    expect(message).toBe('Сессия истекла — войдите снова.');
  });

  it('CSRF-403 → русское сообщение вместо английской строки', async () => {
    const message = await extractApiError(
      jsonResponse(403, { error: 'CSRF validation failed: origin mismatch' }),
      'fallback',
    );
    expect(message).toBe('Запрос отклонён проверкой безопасности. Обновите страницу и повторите.');
  });

  it('400 → добавляет построчные ошибки полей из details', async () => {
    const message = await extractApiError(
      jsonResponse(400, { error: 'Некорректные данные', details: [{ field: 'name', message: 'Required' }] }),
      'fallback',
    );
    expect(message).toBe('Некорректные данные\nПоле name: обязательное поле');
  });
});

describe('useSiteMutations — отказ сервера доходит до человека', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  const options = () => ({ setSites: vi.fn(), setSiteTree: vi.fn(), setExpandedSiteId: vi.fn() });

  it('удаление узла: 409 показывает серверное объяснение, а не «Ошибка удаления» (находка 2)', async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'Нельзя удалить пикет: на нём 3 записей выработки. Сначала перенесите их.' }),
    );
    const { result } = renderHook(() => useSiteMutations(options()));

    await act(async () => { await result.current.handleDeleteHierarchy('s1', 'picket', 'p1'); });

    expect(toast.error).toHaveBeenCalledWith(
      'Нельзя удалить пикет: на нём 3 записей выработки. Сначала перенесите их.',
    );
  });

  it('сохранение объекта: 409 о незавершённых отчётах показывается дословно (находка 9)', async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'Невозможно деактивировать объект: 2 незавершённых отчётов.' }),
    );
    const { result } = renderHook(() => useSiteMutations(options()));

    await act(async () => {
      await result.current.handleSaveEdit('s1', 'Объект', false, [], [], { latitude: null, longitude: null });
    });

    expect(toast.error).toHaveBeenCalledWith('Невозможно деактивировать объект: 2 незавершённых отчётов.');
  });

  it('создание объекта: показывает текст сервера (находка 11)', async () => {
    authFetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'Некорректные данные', details: [{ field: 'name', message: 'Required' }] }),
    );
    const { result } = renderHook(() => useSiteMutations(options()));

    await act(async () => { await result.current.handleCreateSite('Объект', [], []); });

    expect(toast.error).toHaveBeenCalledWith('Некорректные данные\nПоле name: обязательное поле');
  });

  it('добавление узла: текст сервера и false при отказе (находка 10)', async () => {
    authFetchMock.mockResolvedValue(jsonResponse(404, { error: 'Parent not found' }));
    const { result } = renderHook(() => useSiteMutations(options()));

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.handleAddHierarchy('s1', 'parent', 'picket', 'ПК-1'); });

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Parent not found');
  });

  it('обрыв сети при удалении узла → русский текст, не «Failed to fetch»', async () => {
    authFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useSiteMutations(options()));

    await act(async () => { await result.current.handleDeleteHierarchy('s1', 'cluster', 'c1'); });

    expect(toast.error).toHaveBeenCalledWith('Нет соединения с сервером. Проверьте связь и повторите.');
  });

  it('не-JSON ответ сервера → «ответил неожиданно», а не «нет связи» (F-M4-SITES)', async () => {
    authFetchMock.mockResolvedValue(
      new Response('<html>страница-перехватчик</html>', { status: 200 }),
    );
    const { result } = renderHook(() => useSiteMutations(options()));

    await act(async () => { await result.current.handleCreateSite('Объект', [], []); });

    expect(toast.error).toHaveBeenCalledWith('Сервер ответил неожиданно, повторите позже.');
  });
});

describe('catchText — обрыв связи не путается с ответом сервера (F-M4-SITES)', () => {
  it('TypeError от fetch («Failed to fetch») → «Нет соединения»', () => {
    expect(catchText(new TypeError('Failed to fetch'))).toBe(
      'Нет соединения с сервером. Проверьте связь и повторите.',
    );
  });

  it('ошибка разбора ответа (не TypeError) → «Сервер ответил неожиданно»', () => {
    expect(catchText(new SyntaxError('Unexpected token < in JSON'))).toBe(
      'Сервер ответил неожиданно, повторите позже.',
    );
  });

  it('иная ошибка → «Сервер ответил неожиданно», а не «Нет соединения»', () => {
    expect(catchText(new Error('Не удалось разобрать ответ'))).toBe(
      'Сервер ответил неожиданно, повторите позже.',
    );
  });
});

describe('deactivateDescription — окно «Деактивировать объект?»', () => {
  it('называет бригады и установки на объекте', () => {
    expect(deactivateDescription({ crewCount: 2, rigNames: ['Banut 655', 'КБУРГ-16.02 №1'] }))
      .toContain('Сейчас на объекте 2 бригады (установки: Banut 655, КБУРГ-16.02 №1).');
  });

  it('не утверждает «бригад нет», если бригады не загрузились', () => {
    const text = deactivateDescription({ crewCount: null, rigNames: [] });
    expect(text).toContain('не загрузились');
    expect(text).not.toContain('Бригад на объекте нет');
  });
});