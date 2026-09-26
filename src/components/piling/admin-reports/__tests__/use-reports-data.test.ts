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
