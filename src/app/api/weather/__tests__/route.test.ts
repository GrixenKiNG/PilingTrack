/**
 * GET /api/weather — query-param validation for coordinates.
 *
 * F-12: missing or empty lat/lon used to become 0,0 via Number(null)/Number(''),
 * which passed the finite/range check and silently queried the Gulf of Guinea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getWeatherAtMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getWeatherAtMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/weather/weather-client', async () => {
  const actual = await vi.importActual<object>('@/services/weather/weather-client');
  return { ...actual, getWeatherAt: getWeatherAtMock };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from '../route';

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/weather${query}`);
}

describe('GET /api/weather', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    getWeatherAtMock.mockReset();
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'OPERATOR' }, error: null });
  });

  it('возвращает 400 при отсутствующем lat', async () => {
    const res = await GET(req('?lon=30'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Некорректные координаты' });
    expect(getWeatherAtMock).not.toHaveBeenCalled();
  });

  it('возвращает 400 при отсутствующем lon', async () => {
    const res = await GET(req('?lat=50'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Некорректные координаты' });
    expect(getWeatherAtMock).not.toHaveBeenCalled();
  });

  it('возвращает 400 при пустой строке lat', async () => {
    const res = await GET(req('?lat=&lon=30'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Некорректные координаты' });
    expect(getWeatherAtMock).not.toHaveBeenCalled();
  });

  it('возвращает 400 при пустой строке lon', async () => {
    const res = await GET(req('?lat=50&lon='));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Некорректные координаты' });
    expect(getWeatherAtMock).not.toHaveBeenCalled();
  });

  it('возвращает 400, когда оба параметра отсутствуют', async () => {
    const res = await GET(req(''));

    expect(res.status).toBe(400);
  });

  it('по-прежнему возвращает 400 при выходе координат за пределы диапазона', async () => {
    const res = await GET(req('?lat=95&lon=0'));

    expect(res.status).toBe(400);
    expect(getWeatherAtMock).not.toHaveBeenCalled();
  });

  it('отдаёт условия при валидных координатах', async () => {
    getWeatherAtMock.mockResolvedValue({
      windMs: 8.4,
      temperatureC: 12.5,
      precipitationMmPerHour: 0,
      isDay: true,
      at: '2026-09-24T10:00:00.000Z',
    });
    const res = await GET(req('?lat=50.45&lon=30.52'));

    expect(res.status).toBe(200);
    expect(getWeatherAtMock).toHaveBeenCalledWith(50.45, 30.52);
    const body = await res.json();
    expect(body).toEqual({
      temperature: 12.5,
      windSpeed: 8.4,
      windWarning: false,
      windCritical: false,
    });
  });
});