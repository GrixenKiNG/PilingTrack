/**
 * GET /api/maintenance/kpi — behavioural tests.
 *
 * Pins the window bounds of F-R37-3: the screen sends production days as
 * `YYYY-MM-DD`, and the route must turn them into instants by the tenant zone
 * (server process runs in UTC), not parse a naive string in the process zone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, assertCanMock, getSettingsMock, getFleetKpiDataMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getFleetKpiDataMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/modules/settings', () => ({ getSettings: getSettingsMock }));
vi.mock('@/modules/equipment', () => ({ getFleetKpiData: getFleetKpiDataMock }));

import { GET } from '../route';

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/maintenance/kpi?${qs}`);
}

/** The window the route handed to the fleet-KPI query. */
function windowPassed(): { from: Date; to: Date } {
  const [, from, to] = getFleetKpiDataMock.mock.calls[0];
  return { from, to };
}

describe('GET /api/maintenance/kpi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow' });
    getFleetKpiDataMock.mockResolvedValue({ records: [], equipmentCount: 0 });
  });

  it('returns the auth error without reading settings or data', async () => {
    const authError = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authError });

    const response = await GET(req('from=2026-09-20&to=2026-09-26'));

    expect(response.status).toBe(401);
    expect(getSettingsMock).not.toHaveBeenCalled();
    expect(getFleetKpiDataMock).not.toHaveBeenCalled();
  });

  it('turns plain days into zone midnight bounds and the day after «to» as the exclusive end', async () => {
    const response = await GET(req('from=2026-09-20&to=2026-09-26'));

    expect(response.status).toBe(200);
    const { from, to } = windowPassed();
    // МСК = UTC+3: сутки 20.09 начинаются в 19.09T21:00Z, конец периода —
    // полночь 27.09 МСК, то есть 26.09T21:00Z.
    expect(from.toISOString()).toBe('2026-09-19T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-26T21:00:00.000Z');
    expect(await response.json()).toMatchObject({
      period: { from: '2026-09-19T21:00:00.000Z', to: '2026-09-26T21:00:00.000Z' },
    });
  });

  it('uses the organisation timezone, not Moscow, when the tenant is elsewhere', async () => {
    getSettingsMock.mockResolvedValue({ timezone: 'Asia/Vladivostok' });

    await GET(req('from=2026-09-20&to=2026-09-26'));

    const { from, to } = windowPassed();
    // Владивосток = UTC+10: 20.09 начинается в 19.09T14:00Z, конец — 26.09T14:00Z.
    expect(from.toISOString()).toBe('2026-09-19T14:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-26T14:00:00.000Z');
  });

  it('falls back to Europe/Moscow when the tenant has no timezone', async () => {
    getSettingsMock.mockResolvedValue({});

    await GET(req('from=2026-09-20&to=2026-09-26'));

    expect(windowPassed().from.toISOString()).toBe('2026-09-19T21:00:00.000Z');
  });

  it('still accepts a full ISO timestamp as an instant (backward compatibility)', async () => {
    await GET(req('from=2026-09-20T00:00:00Z&to=2026-09-26T23:59:59Z'));

    const { from, to } = windowPassed();
    expect(from.toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-26T23:59:59.000Z');
  });

  it('rejects a reversed or unparsable range with 400 and does not query data', async () => {
    const reversed = await GET(req('from=2026-09-26&to=2026-09-20'));
    expect(reversed.status).toBe(400);

    getFleetKpiDataMock.mockClear();
    const junk = await GET(req('from=абв&to=2026-09-26'));
    expect(junk.status).toBe(400);

    getFleetKpiDataMock.mockClear();
    const equalDays = await GET(req('from=2026-09-20&to=2026-09-20'));
    // to exclusive → 21.09T00:00 MSK > 20.09T00:00 MSK, a valid one-day window.
    expect(equalDays.status).toBe(200);
    const { from, to } = windowPassed();
    expect(to.getTime() - from.getTime()).toBe(86_400_000);
  });
});
