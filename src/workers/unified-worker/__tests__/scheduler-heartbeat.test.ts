/**
 * Пульс планировщиков (F-SCHEDULER-HEARTBEAT).
 *
 * Проверяет обещания фикса:
 *  - ключ `system:scheduler:<имя>` пишется в инстанс СОСТОЯНИЯ Redis (не в кэш)
 *    с TTL в три интервала планировщика;
 *  - сбой Redis не бросает — прогон планировщика из-за пульса не ломается.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stateSet: vi.fn(),
  cacheSet: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/*
  Два инстанса, а не один: пульс — состояние (noeviction), а не кэш (allkeys-lru).
  Запись мимо инстанса видна только тестом — на проде это та же ловушка двух
  Redis, что и с пульсом служб (см. getStateRedisClient).
*/
vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: vi.fn(async () => ({ set: mocks.cacheSet })),
  getStateRedisClient: vi.fn(async () => ({ set: mocks.stateSet })),
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

import { recordSchedulerHeartbeat } from '@/workers/unified-worker/scheduler-heartbeat';

describe('пульс планировщиков (F-SCHEDULER-HEARTBEAT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('пишет ISO-время в инстанс состояния с TTL в три интервала', async () => {
    await recordSchedulerHeartbeat('pm-scheduler', 24 * 60 * 60 * 1000);

    expect(mocks.stateSet).toHaveBeenCalledTimes(1);
    const [key, value, mode, ttl] = mocks.stateSet.mock.calls[0];
    expect(key).toBe('system:scheduler:pm-scheduler');
    expect(mode).toBe('EX');
    expect(ttl).toBe(3 * 24 * 60 * 60);
    // Время — валидная ISO-дата момента записи, а не число и не пустая строка.
    expect(new Date(value as string).getTime()).toBeGreaterThan(Date.now() - 60_000);

    // Кэш-клиент ключа пульса не видит — запись ушла не в вытесняемый инстанс.
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it('часовой планировщик получает TTL в три часа', async () => {
    await recordSchedulerHeartbeat('readiness-scheduler', 60 * 60 * 1000);

    expect(mocks.stateSet).toHaveBeenCalledWith(
      'system:scheduler:readiness-scheduler',
      expect.any(String),
      'EX',
      3 * 60 * 60,
    );
  });

  it('отказ Redis не бросает и уходит в logger.warn', async () => {
    mocks.stateSet.mockRejectedValue(new Error('redis down'));

    await expect(
      recordSchedulerHeartbeat('projection-rebuild', 24 * 60 * 60 * 1000),
    ).resolves.toBeUndefined();

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to record scheduler heartbeat',
      expect.objectContaining({ scheduler: 'projection-rebuild' }),
    );
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });
});
