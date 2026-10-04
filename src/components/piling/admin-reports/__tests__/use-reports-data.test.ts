/**
 * Regression for the 2026-05-30 incident: when the reports request fails with
 * an HTTP error, `fetch` resolves with `res.ok === false` and does NOT throw.
 * The hook used to ignore that branch, so a 500 rendered as a silently-empty
 * "Нет отчётов" list. It must now surface an `error` instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useReportsData } from '../use-reports-data';

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('useReportsData — error visibility', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('sets error (not an empty list) when the reports request returns 500', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/reports')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      // sites + operators load fine
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.reports).toEqual([]);
  });

  it('does not set error when the reports request succeeds', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/reports')) {
        return Promise.resolve(okJson({ reports: [{ id: 'r1' }] }));
      }
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.reports).toHaveLength(1);
  });
});

/**
 * F-R93-1: 403 на списке рисовался как «Сервер вернул ошибку.» с кнопкой
 * «Повторить», которая отказывала всегда — причина не в сбое сервера, а в
 * правах (режим «Действую как OPERATOR»). Текст и отсутствие повтора должны
 * отличать 403 от 5xx.
 */
describe('useReportsData — 403 против 5xx', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('403 → текст про права и errorForbidden=true', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/reports')) {
        return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Доступ запрещён' }) });
      }
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Нет прав на просмотр отчётов. Смените роль или обратитесь к администратору.');
    expect(result.current.errorForbidden).toBe(true);
  });

  it('500 → прежний текст про сбой и errorForbidden=false (повтор осмыслен)', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/reports')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Не удалось загрузить отчёты. Сервер вернул ошибку.');
    expect(result.current.errorForbidden).toBe(false);
  });
});

/**
 * F-R93-11: отказ «Загрузить ещё» ставил общий `error` и заменял весь список
 * баннером — уже загруженные отчёты исчезали с экрана, хотя никуда не делись.
 */
describe('useReportsData — отказ догрузки не стирает список', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('500 на догрузке → loadMoreError, список и error на месте', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.includes('cursor=')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      if (url.startsWith('/api/reports')) {
        return Promise.resolve(okJson({ reports: [{ id: 'r1' }], hasMore: true, nextCursor: 'c1' }));
      }
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reports).toHaveLength(1);

    await act(async () => { await result.current.loadMoreReports(); });

    expect(result.current.loadMoreError).toBe('Не удалось догрузить отчёты. Сервер вернул ошибку.');
    expect(result.current.error).toBeNull();
    expect(result.current.reports).toHaveLength(1);
  });
});

/**
 * F-R21-3: отказ чтения /api/dictionary/all диалог отчёта показывал как пустые
 * списки «Марка сваи / Тип скважины / Причина простоя» — то есть «данных нет».
 * Плюс после отказа `referenceDataLoadedRef` запрещал повторный запрос навсегда.
 */
describe('useReportsData — справочники формы', () => {
  const DICTIONARY_FAILED = 'Справочники не загрузились — списки в форме пустые';

  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  function mockRoutes(dictionary: () => Promise<unknown>) {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/dictionary')) return dictionary();
      if (url.startsWith('/api/reports')) return Promise.resolve(okJson({ reports: [] }));
      return Promise.resolve(okJson({}));
    });
  }

  it('403 → «Нет доступа к справочникам» и ровно один тост', async () => {
    mockRoutes(() => Promise.resolve({ ok: false, status: 403, json: async () => ({}) }));

    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.loadReferenceData(); });

    expect(result.current.dictionaryError).toBe('Нет доступа к справочникам');
    expect(result.current.loadingReferenceData).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Нет доступа к справочникам');
  });

  it('сетевой сбой → общая формулировка, а не молчание', async () => {
    mockRoutes(() => Promise.reject(new TypeError('Failed to fetch')));

    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.loadReferenceData(); });

    expect(result.current.dictionaryError).toBe(DICTIONARY_FAILED);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('500 не залипает: повторный вызов снова идёт в сеть и снимает ошибку', async () => {
    mockRoutes(() => Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));

    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.loadReferenceData(); });
    expect(result.current.dictionaryError).toBe(DICTIONARY_FAILED);

    mockRoutes(() => Promise.resolve(okJson({ pileGrades: [{ id: 'g1', name: 'С90.30' }] })));
    await act(async () => { await result.current.loadReferenceData(); });

    const dictionaryCalls = authFetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/dictionary'));
    expect(dictionaryCalls).toHaveLength(2);
    expect(result.current.dictionaryError).toBeNull();
    expect(result.current.pileGrades).toHaveLength(1);
  });
});

/**
 * F-R133 №8: чтение списка отчётов на истёкшей сессии показывало
 * «Не удалось загрузить отчёты. Сервер вернул ошибку.» — причина названа
 * неверно, сбой не на сервере. Теперь 401 отличается от 5xx.
 */
describe('useReportsData — 401 против 5xx (F-R133 №8)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('401 → текст про истёкшую сессию, а не «Сервер вернул ошибку»', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/reports')) {
        return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
      }
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Сессия истекла — войдите снова.');
    expect(result.current.errorForbidden).toBe(false);
  });
});

/**
 * R135 №5: сбой чтения списка показывался дважды — тостом «Ошибка загрузки
 * отчётов» и красным баннером с «Повторить». Тост убран: причина и повтор
 * остаются в баннере.
 */
describe('useReportsData — сбой чтения не дублируется тостом (R135 №5)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('500 на списке → error есть, тоста «Ошибка загрузки отчётов» нет', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/reports')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return Promise.resolve(okJson({ sites: [], users: [] }));
    });

    const { result } = renderHook(() => useReportsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Не удалось загрузить отчёты. Сервер вернул ошибку.');
    expect(toast.error).not.toHaveBeenCalledWith('Ошибка загрузки отчётов');
  });
});
