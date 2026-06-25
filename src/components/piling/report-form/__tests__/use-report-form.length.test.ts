/**
 * Regression for the 2026-06-25 incident (browser QA): the report form derived
 * м.п. by parsing the grade *name* and grabbed the last number — for "С 100-35"
 * it read 35 m/pile instead of the stored length (10 m), so the form showed
 * 12×35=420 м.п. while the server/PDF/history correctly stored 12×10=120.
 *
 * `getPileMetersPerUnit` must read `PileGrade.lengthMm` via lib/pile-length and
 * never re-parse the name. This guard fails if name-parsing is reintroduced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
