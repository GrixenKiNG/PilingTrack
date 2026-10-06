/**
 * Чтение целочисленных настроек окружения (F-WORKER-ENV-INTS).
 *
 * Проверяет обещания помощника: мусор, 0, отрицательное и запредельное значение
 * откатываются к значению по умолчанию и попадают в лог с именем переменной;
 * нормальное число возвращается как есть.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: mocks.logger,
}));

const KEY = 'TEST_WORKER_INT_ENV';

async function load(): Promise<typeof import('@/workers/unified-worker/env-int')> {
  return import('@/workers/unified-worker/env-int');
}

describe('positiveIntEnv (F-WORKER-ENV-INTS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[KEY];
  });

  afterEach(() => {
    delete process.env[KEY];
  });

  it('мусор не проходит: fallback и warn с именем переменной', async () => {
    process.env[KEY] = 'abc';
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(8000);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Invalid integer env value, using fallback',
      expect.objectContaining({ name: KEY }),
    );
  });

  it('нуль не проходит: fallback (дедлайн не срабатывает сразу)', async () => {
    process.env[KEY] = '0';
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(8000);
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('отрицательное не проходит: fallback', async () => {
    process.env[KEY] = '-1';
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(8000);
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('запредельное для таймера не проходит: fallback (задержка > 2^31-1)', async () => {
    process.env[KEY] = String(2 ** 31);
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(8000);
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('нецелое не проходит: fallback', async () => {
    process.env[KEY] = '1.5';
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(8000);
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('нормальное значение возвращается как есть, без warn', async () => {
    process.env[KEY] = '1500';
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(1500);
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it('незаданная и пустая переменная — это значение по умолчанию, без warn', async () => {
    const { positiveIntEnv } = await load();

    expect(positiveIntEnv(KEY, 8000)).toBe(8000);

    process.env[KEY] = '  ';
    expect(positiveIntEnv(KEY, 8000)).toBe(8000);
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it('границы порта: 65535 проходит, 70000 и 0 — нет', async () => {
    const { positiveIntEnv } = await load();

    process.env[KEY] = '65535';
    expect(positiveIntEnv(KEY, 3002, { max: 65535 })).toBe(65535);

    process.env[KEY] = '70000';
    expect(positiveIntEnv(KEY, 3002, { max: 65535 })).toBe(3002);

    process.env[KEY] = '0';
    expect(positiveIntEnv(KEY, 3002, { max: 65535 })).toBe(3002);
  });

  it('нижняя граница, заданная вызывающим, соблюдается', async () => {
    const { positiveIntEnv } = await load();

    process.env[KEY] = '100';
    expect(positiveIntEnv(KEY, 60000, { min: 100 })).toBe(100);

    process.env[KEY] = '99';
    expect(positiveIntEnv(KEY, 60000, { min: 100 })).toBe(60000);
  });
});
