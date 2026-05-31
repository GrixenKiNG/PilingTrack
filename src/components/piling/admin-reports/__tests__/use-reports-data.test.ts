/**
 * Regression for the 2026-05-30 incident: when the reports request fails with
 * an HTTP error, `fetch` resolves with `res.ok === false` and does NOT throw.
 * The hook used to ignore that branch, so a 500 rendered as a silently-empty
 * "Нет отчётов" list. It must now surface an `error` instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
