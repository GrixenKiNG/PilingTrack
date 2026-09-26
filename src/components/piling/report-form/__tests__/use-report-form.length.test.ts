/**
 * Regression for the 2026-06-25 incident (browser QA): the report form derived
 * м.п. by parsing the grade *name* and grabbed the last number — for "С 100-35"
 * it read 35 m/pile instead of the stored length (10 m), so the form showed
 * 12×35=420 м.п. while the server/PDF/history correctly stored 12×10=120.
 *
 * `getPileMetersPerUnit` must read `PileGrade.lengthMm` via lib/pile-length and
 * never re-parse the name. This guard fails if name-parsing is reintroduced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { toast } from 'sonner';

const { authFetchMock } = vi.hoisted(() => ({ authFetchMock: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/haptic-feedback', () => ({ hapticClick: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock('@/lib/client-feedback', () => ({ pushClientFeedback: vi.fn() }));

// Minimal store: operator with no selected site, so the form loads the
// dictionary but skips the existing-report fetch.
const storeState = {
  currentUser: { id: 'op1', role: 'OPERATOR', name: 'Тест' },
  selectedSiteId: '',
  setSelectedSite: vi.fn(),
};
vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

import { useReportForm } from '../use-report-form';

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const GRADE = { id: 'g1', name: 'С 100-35', isActive: true, lengthMm: 10000 };

describe('useReportForm — pile metres come from lengthMm, not the name', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/dictionary/all')) {
        return Promise.resolve(okJson({ pileGrades: [GRADE], drillingTypes: [], downtimeReasons: [] }));
      }
      if (url.startsWith('/api/sites')) return Promise.resolve(okJson({ data: [] }));
      if (url.startsWith('/api/equipment')) return Promise.resolve(okJson({ data: [] }));
      return Promise.resolve(okJson({}));
    });
  });

  it('returns the stored length (10 m) for "С 100-35", not the cross-section (35)', async () => {
    const { result } = renderHook(() => useReportForm());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.pileGrades).toHaveLength(1));

    expect(result.current.getPileMetersPerUnit('g1')).toBe(10);
  });

  it('returns 0 for an unknown grade (never a silently-wrong guess)', async () => {
    const { result } = renderHook(() => useReportForm());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.getPileMetersPerUnit('does-not-exist')).toBe(0);
  });
});

describe('useReportForm — архивная марка строки старого отчёта (F-R29-2)', () => {
  // Марка снята с активных (админ архивировал), но закреплена за сданным
  // отчётом. Выбор её не предлагает, однако строка отчёта обязана показать
  // название и метры, а не сырой cuid и 0 м.п.
  const ARCHIVED_GRADE = { id: 'g-arch', name: 'СВ 300-80', isActive: false, lengthMm: 12000 };

  beforeEach(() => {
    authFetchMock.mockReset();
    storeState.selectedSiteId = 'site-1';
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/dictionary/all')) {
        return Promise.resolve(okJson({ pileGrades: [GRADE, ARCHIVED_GRADE], drillingTypes: [], downtimeReasons: [] }));
      }
      if (url.startsWith('/api/sites')) return Promise.resolve(okJson({ data: [] }));
      if (url.startsWith('/api/equipment')) return Promise.resolve(okJson({ data: [] }));
      if (url.startsWith('/api/reports/edit')) {
        return Promise.resolve(okJson({ report: { reportId: 'r1', piles: [{ id: 'p1', pileGradeId: 'g-arch', count: 4 }] } }));
      }
      return Promise.resolve(okJson({}));
    });
  });

  afterEach(() => { storeState.selectedSiteId = ''; });

  it('резолвит название и длину архивной марки, а не cuid и 0 м.п.', async () => {
    const { result } = renderHook(() => useReportForm());

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.piles).toHaveLength(1));

    expect(result.current.piles[0].pileGradeId).toBe('g-arch');
    expect(result.current.getPileGradeName('g-arch')).toBe('СВ 300-80');
    expect(result.current.getPileMetersPerUnit('g-arch')).toBe(12);
  });
});

describe('useReportForm — equipment list load failure is surfaced, not swallowed', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('shows a toast when the equipment request fails (network error)', async () => {
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/equipment')) return Promise.reject(new Error('network'));
      if (url.startsWith('/api/dictionary/all')) return Promise.resolve(okJson({ pileGrades: [GRADE], drillingTypes: [], downtimeReasons: [] }));
      if (url.startsWith('/api/sites')) return Promise.resolve(okJson({ data: [] }));
      return Promise.resolve(okJson({}));
    });

    renderHook(() => useReportForm());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Не удалось загрузить список установок'));
    // The form must still work with the empty list — loading settles without a loadError.
    await waitFor(() => expect(vi.mocked(authFetchMock)).toHaveBeenCalledWith('/api/equipment'));
  });
});

describe('useReportForm — нецелые моточасы не теряются молча', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    authFetchMock.mockReset();
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/dictionary/all')) {
        return Promise.resolve(okJson({ pileGrades: [GRADE], drillingTypes: [], downtimeReasons: [] }));
      }
      if (url.startsWith('/api/sites')) return Promise.resolve(okJson({ data: [] }));
      if (url.startsWith('/api/equipment')) return Promise.resolve(okJson({ data: [] }));
      return Promise.resolve(okJson({}));
    });
  });

  it('блокирует отправку и называет причину, если показание не целое', async () => {
    storeState.selectedSiteId = 'site-1';
    try {
      const { result } = renderHook(() => useReportForm());

      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => { result.current.setEngineHours('5701.5'); });
      await waitFor(() => expect(result.current.engineHours).toBe('5701.5'));

      authFetchMock.mockClear();
      await act(async () => {
        await result.current.handleSubmit({ pile: { gradeId: 'g1', count: 2 } });
      });

      // Ни «успеха», ни тишины: говорим, что именно не так, и отчёт не отправляем.
      expect(toast.error).toHaveBeenCalledWith('Моточасы — целое число, не меньше 0');
      expect(authFetchMock).not.toHaveBeenCalledWith('/api/reports/upsert', expect.anything());
    } finally {
      storeState.selectedSiteId = '';
    }
  });
});

describe('useReportForm — построчные ошибки сервера доходят до оператора', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    authFetchMock.mockReset();
    authFetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/dictionary/all')) {
        return Promise.resolve(okJson({ pileGrades: [GRADE], drillingTypes: [], downtimeReasons: [] }));
      }
      if (url.startsWith('/api/sites')) return Promise.resolve(okJson({ data: [] }));
      if (url.startsWith('/api/equipment')) return Promise.resolve(okJson({ data: [] }));
      if (url.startsWith('/api/reports/upsert')) {
        // 400 операторского маршрута: `details` — массив { field, message }.
        return Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Некорректные данные',
            details: [{ field: 'piles.0.count', message: 'Количество должно быть больше 0' }],
          }),
        });
      }
      return Promise.resolve(okJson({}));
    });
  });

  it('называет поле из details вместо одного «Некорректные данные»', async () => {
    storeState.selectedSiteId = 'site-1';
    try {
      const { result } = renderHook(() => useReportForm());

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.handleSubmit({ pile: { gradeId: 'g1', count: 2 } });
      });

      expect(toast.error).toHaveBeenCalledWith(
        'Некорректные данные\nСваи, строка 1: количество: Количество должно быть больше 0',
      );
      expect(toast.success).not.toHaveBeenCalledWith('Отчёт успешно отправлен!');
    } finally {
      storeState.selectedSiteId = '';
    }
  });
});
