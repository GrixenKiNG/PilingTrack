import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ siteFindFirst: vi.fn(), getOrSet: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { site: { findFirst: m.siteFindFirst } } }));
vi.mock('@/lib/redis-cache', () => ({ cache: { getOrSet: m.getOrSet } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: m.warn, info: vi.fn(), error: vi.fn() } }));

import { getSiteWind } from '../weather-client';

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.getOrSet.mockImplementation((_key: string, compute: () => Promise<unknown>) => compute());
});

describe('getSiteWind', () => {
  // Наружу не ходим, пока координат нет: лишний запрос ради заведомого промаха
  // тратит квоту и время оператора.
  it('без координат не обращается к сервису', async () => {
    m.siteFindFirst.mockResolvedValue({ latitude: null, longitude: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(getSiteWind('orion', 'site-1')).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('чужой объект не читает', async () => {
    m.siteFindFirst.mockResolvedValue(null);
    await expect(getSiteWind('orion', 'site-чужой')).resolves.toBeNull();
    expect(m.siteFindFirst.mock.calls[0][0].where).toMatchObject({ tenantId: 'orion' });
  });

  it('возвращает показание сервиса', async () => {
    m.siteFindFirst.mockResolvedValue({ latitude: 55.7, longitude: 37.6 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ current: { wind_speed_10m: 18.34, time: '2026-08-20T09:00' } }),
    } as Response);
    await expect(getSiteWind('orion', 'site-1')).resolves.toEqual({
      windMs: 18.3, source: 'SERVICE', at: '2026-08-20T09:00',
    });
    vi.restoreAllMocks();
  });

  // Погодный сервис не должен уметь остановить работу на площадке.
  it('на отказе сети отдаёт null, а не ошибку', async () => {
    m.siteFindFirst.mockResolvedValue({ latitude: 55.7, longitude: 37.6 });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(getSiteWind('orion', 'site-1')).resolves.toBeNull();
    expect(m.warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
