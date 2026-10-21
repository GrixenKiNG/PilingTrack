import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorTracker, recordError, recordRequest } from '../error-tracker';

/*
  Трекер ошибок — счётчик для размыкателя и бюджета SLO. Внешних сервисов у
  него нет: всё считается в памяти процесса, поэтому «мокать» нечего — вместо
  этого проверяем, что сеть действительно не трогается.

  Контекст записи наружу не отдаётся (ни getStats, ни отдельного метода), а
  проверить его сохранение надо: читаем приватный массив через приведение
  типа, продуктовый код не меняем.
*/
type StoredRecord = {
  domain: string;
  error: Error;
  context: Record<string, unknown>;
  timestamp: number;
};

function storedRecords(): StoredRecord[] {
  return (errorTracker as unknown as { records: StoredRecord[] }).records;
}

function lastRecord(forDomain: string): StoredRecord | undefined {
  const own = storedRecords().filter((r) => r.domain === forDomain);
  return own[own.length - 1];
}

// У синглтона нет сброса, поэтому у каждого теста свой домен: статистика
// одного теста не должна попадать в статистику другого.
let domainSeq = 0;
function newDomain(name: string): string {
  domainSeq += 1;
  return `test-${name}-${domainSeq}`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('учёт ошибок по доменам', () => {
  it('регистрирует ошибку с контекстом и считает её только в своём домене', () => {
    const own = newDomain('own');
    const other = newDomain('other');

    recordError({
      domain: own,
      error: new Error('таймаут внешнего API'),
      context: { handler: 'getReports', traceId: 'trace-1' },
    });
    recordError({ domain: other, error: new Error('чужая ошибка') });

    expect(errorTracker.getStats(own).totalErrors).toBe(1);
    expect(errorTracker.getStats(other).totalErrors).toBe(1);
    // Запись легла вместе с контекстом — он нужен, чтобы разобрать инцидент.
    expect(lastRecord(own)?.context).toEqual({ handler: 'getReports', traceId: 'trace-1' });
  });

  it('повторы не группируются: каждый вызов — отдельная запись и отдельный счёт', () => {
    const d = newDomain('repeats');
    const same = new Error('одна и та же ошибка');

    recordError({ domain: d, error: same });
    recordError({ domain: d, error: same });
    recordError({ domain: d, error: same });

    expect(errorTracker.getStats(d).totalErrors).toBe(3);
    expect(storedRecords().filter((r) => r.domain === d)).toHaveLength(3);
  });

  it('считает errorRate как долю запросов, а без запросов отдаёт 0, а не деление на ноль', () => {
    const d = newDomain('rate');

    expect(errorTracker.getStats(d)).toMatchObject({ totalRequests: 0, totalErrors: 0, errorRate: 0 });

    for (let i = 0; i < 4; i += 1) recordRequest(d);
    recordError({ domain: d, error: new Error('сбой') });

    expect(errorTracker.getStats(d)).toMatchObject({ totalRequests: 4, totalErrors: 1, errorRate: 0.25 });
  });

  it('порог размыкателя превышается строго: равенство порогу ещё не авария', () => {
    const d = newDomain('threshold');

    for (let i = 0; i < 8; i += 1) recordRequest(d);
    recordError({ domain: d, error: new Error('сбой 1') });
    recordError({ domain: d, error: new Error('сбой 2') });

    // 2 из 8 = ровно 0.25 — размыкатель молчит.
    expect(errorTracker.isErrorRateExceeded(d, 0.25)).toBe(false);

    recordError({ domain: d, error: new Error('сбой 3') });

    // 3 из 8 = 0.375 — порог превышен.
    expect(errorTracker.isErrorRateExceeded(d, 0.25)).toBe(true);
  });
});

describe('работа без внешнего сервиса', () => {
  it('считает в памяти и не ходит в сеть', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const d = newDomain('offline');

    recordError({ domain: d, error: new Error('сбой') });
    recordRequest(d);

    expect(errorTracker.getStats(d)).toMatchObject({ totalErrors: 1, totalRequests: 1, errorRate: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('контекст и секреты', () => {
  it.fails('не сохраняет в памяти пароль и токен из контекста', () => {
    const d = newDomain('secrets');

    recordError({
      domain: d,
      error: new Error('не удалось войти'),
      context: { password: 'Пароль123', token: 'Bearer eyJhbGciOi' },
    });

    // дефект: context кладётся в records как есть (error-tracker.ts:46-51).
    // Редактирования секретов, как в logger (X9), здесь нет, поэтому пароль и
    // токен живут в памяти процесса до prune — если вызывающий положит их в
    // контекст, трекер их сохранит.
    const context = lastRecord(d)?.context ?? {};
    expect(JSON.stringify(context)).not.toContain('Пароль123');
    expect(JSON.stringify(context)).not.toContain('eyJhbGciOi');
  });
});

describe('окно и память', () => {
  it('prune выбрасывает записи старше окна в 60 секунд', () => {
    vi.useFakeTimers();
    const start = new Date('2026-10-21T10:00:00Z');
    vi.setSystemTime(start);
    const d = newDomain('prune');

    recordError({ domain: d, error: new Error('старая') });
    recordRequest(d);

    vi.setSystemTime(new Date(start.getTime() + 30_000));
    recordError({ domain: d, error: new Error('свежая') });
    recordRequest(d);
    expect(errorTracker.getStats(d)).toMatchObject({ totalErrors: 2, totalRequests: 2 });

    vi.setSystemTime(new Date(start.getTime() + 61_000));
    errorTracker.prune();

    // Свежая запись ещё в окне, старая — уже нет.
    expect(errorTracker.getStats(d)).toMatchObject({ totalErrors: 1, totalRequests: 1 });
  });

  it('ограничивает память: сверх maxRecords старые записи вытесняются', async () => {
    // Свой инстанс, иначе пришлось бы забивать общий синглтон на весь прогон.
    vi.resetModules();
    const fresh = await import('../error-tracker');
    const d = 'test-cap';
    const failure = new Error('сбой');

    for (let i = 0; i < 10_001; i += 1) fresh.recordError({ domain: d, error: failure });

    expect(fresh.errorTracker.getStats(d).totalErrors).toBe(10_000);
  });
});
