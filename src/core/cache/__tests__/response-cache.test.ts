/**
 * Response Cache — Unit Tests
 *
 * Наблюдаемое поведение BFF-кэша: попадание/промах, время жизни записи,
 * клонирование ответа, изоляция по организации, склейка одновременных
 * запросов и сброс по префиксу.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ResponseCache } from '../response-cache';

const NOW = new Date('2026-10-21T10:00:00Z');
const TTL = 1_000;
const STALE_WHILE_REVALIDATE = 1_000;

let cache: ResponseCache;

function json(body: unknown): NextResponse {
  return NextResponse.json(body);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  cache = new ResponseCache({
    defaultTTL: TTL,
    staleWhileRevalidate: STALE_WHILE_REVALIDATE,
    maxEntries: 100,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('попадания и ключ', () => {
  it('промах уходит в источник, повторный запрос отдаёт тело из кэша', async () => {
    const fetchFn = vi.fn(async () => json({ reports: ['r1'] }));
    const key = { endpoint: 'GET:/api/reports' };

    await cache.getOrFetch(key, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const cached = await cache.getOrFetch(key, fetchFn);

    expect(await cached.json()).toEqual({ reports: ['r1'] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('чтение тела выданного ответа не съедает закэшированный ответ', async () => {
    const fetchFn = vi.fn(async () => json({ reports: ['r1'] }));
    const key = { endpoint: 'GET:/api/reports' };

    const first = await cache.getOrFetch(key, fetchFn);
    expect(await first.json()).toEqual({ reports: ['r1'] });

    // Кэш хранит собственную копию тела: прочитанное у первого ответа не
    // делает следующую выдачу нечитаемой.
    const second = await cache.getOrFetch(key, fetchFn);
    expect(await second.json()).toEqual({ reports: ['r1'] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('ключ учитывает организацию: одинаковая ручка разных организаций не смешивается', async () => {
    const fetchOrion = vi.fn(async () => json({ tenant: 'orion' }));
    const fetchMimecast = vi.fn(async () => json({ tenant: 'mimecast' }));

    const orion = await cache.getOrFetch(
      { endpoint: 'GET:/api/reports', tenantId: 'orion' },
      fetchOrion,
    );
    const mimecast = await cache.getOrFetch(
      { endpoint: 'GET:/api/reports', tenantId: 'mimecast' },
      fetchMimecast,
    );

    expect(await orion.json()).toEqual({ tenant: 'orion' });
    expect(await mimecast.json()).toEqual({ tenant: 'mimecast' });
    expect(fetchOrion).toHaveBeenCalledTimes(1);
    expect(fetchMimecast).toHaveBeenCalledTimes(1);
  });
});

describe('время жизни записи', () => {
  it('после TTL и окна stale-while-revalidate источник вызывается заново', async () => {
    let version = 1;
    const fetchFn = vi.fn(async () => json({ version: version++ }));
    const key = { endpoint: 'GET:/api/reports' };

    const first = await cache.getOrFetch(key, fetchFn);
    expect(await first.json()).toEqual({ version: 1 });

    vi.setSystemTime(new Date(NOW.getTime() + TTL + STALE_WHILE_REVALIDATE + 1));

    const second = await cache.getOrFetch(key, fetchFn);
    expect(await second.json()).toEqual({ version: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('в окне stale-while-revalidate отдаёт устаревший ответ и обновляет запись в фоне', async () => {
    let version = 1;
    const fetchFn = vi.fn(async () => json({ version: version++ }));
    const key = { endpoint: 'GET:/api/reports' };

    await cache.getOrFetch(key, fetchFn);

    vi.setSystemTime(new Date(NOW.getTime() + TTL + 500));

    const stale = await cache.getOrFetch(key, fetchFn);
    expect(await stale.json()).toEqual({ version: 1 });
    // Ответ отдан сразу, обновление уже запущено.
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(0);

    // После фонового обновления та же ячейка отдаёт свежее тело.
    const refreshed = await cache.getOrFetch(key, fetchFn);
    expect(await refreshed.json()).toEqual({ version: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('склейка запросов и сброс', () => {
  it('одновременные одинаковые запросы склеиваются в один поход в источник', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchFn = vi.fn(async () => {
      await gate;
      return json({ ok: true });
    });
    const key = { endpoint: 'GET:/api/reports' };

    const first = cache.getOrFetch(key, fetchFn);
    const second = cache.getOrFetch(key, fetchFn);
    release();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await firstResponse.json()).toEqual({ ok: true });
    expect(await secondResponse.json()).toEqual({ ok: true });
  });

  it('сброс по префиксу с организацией снимает только её ячейки — повторный запрос возвращает свежий ответ', async () => {
    let orionVersion = 1;
    let mimecastVersion = 1;
    const fetchOrion = vi.fn(async () => json({ tenant: 'orion', version: orionVersion++ }));
    const fetchMimecast = vi.fn(async () => json({ tenant: 'mimecast', version: mimecastVersion++ }));

    // Первый запрос — кладёт в кэш
    const orionFirst = await cache.getOrFetch({ endpoint: 'GET:/api/reports', tenantId: 'orion' }, fetchOrion);
    const mimecastFirst = await cache.getOrFetch({ endpoint: 'GET:/api/reports', tenantId: 'mimecast' }, fetchMimecast);

    expect(await orionFirst.json()).toEqual({ tenant: 'orion', version: 1 });
    expect(await mimecastFirst.json()).toEqual({ tenant: 'mimecast', version: 1 });

    // Инвалидация только orion
    cache.invalidate('GET:/api/reports', { tenantId: 'orion' });

    // Повторный запрос orion должен вернуть НОВОЕ значение (версия 2)
    const orionAfterInvalidate = await cache.getOrFetch({ endpoint: 'GET:/api/reports', tenantId: 'orion' }, fetchOrion);
    expect(await orionAfterInvalidate.json()).toEqual({ tenant: 'orion', version: 2 });

    // mimecast не должен инвалидироваться — возвращает старое значение
    const mimecastAfterInvalidate = await cache.getOrFetch({ endpoint: 'GET:/api/reports', tenantId: 'mimecast' }, fetchMimecast);
    expect(await mimecastAfterInvalidate.json()).toEqual({ tenant: 'mimecast', version: 1 });

    // Проверка вызовов как дополнительная гарантия
    expect(fetchOrion).toHaveBeenCalledTimes(2);
    expect(fetchMimecast).toHaveBeenCalledTimes(1);
  });

  it('сброс по организации не задевает организацию, чей id начинается так же — повторный запрос возвращает тот же ответ', async () => {
    // дефект: invalidate ищет организацию подстрокой — `key.includes('t:orion')`
    // совпадает и с ключом `t:orion2`, поэтому сброс одной организации снимает
    // и ячейку соседней.
    let neighbourVersion = 1;
    const fetchNeighbour = vi.fn(async () => json({ tenant: 'orion2', version: neighbourVersion++ }));

    // Первый запрос — кладёт в кэш
    const first = await cache.getOrFetch({ endpoint: 'GET:/api/reports', tenantId: 'orion2' }, fetchNeighbour);
    expect(await first.json()).toEqual({ tenant: 'orion2', version: 1 });

    // Инвалидация orion (не orion2)
    cache.invalidate('GET:/api/reports', { tenantId: 'orion' });

    // Повторный запрос orion2 должен вернуть ТО ЖЕ значение (версия 1), так как кэш не должен был сброситься
    const afterInvalidate = await cache.getOrFetch({ endpoint: 'GET:/api/reports', tenantId: 'orion2' }, fetchNeighbour);
    expect(await afterInvalidate.json()).toEqual({ tenant: 'orion2', version: 1 });

    // Проверка вызовов как дополнительная гарантия — источник не должен вызываться повторно
    expect(fetchNeighbour).toHaveBeenCalledTimes(1);
  });
});
