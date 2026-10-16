import {describe, expect, it, vi} from 'vitest';
import {PrismaCommandIdempotencyRepository} from '../idempotency-repository';

/*
  claim ставит lock_timeout = 1 с, чтобы повтор той же команды не ждал вечно. Эта
  секунда относится ТОЛЬКО к claim: SET LOCAL живёт до конца транзакции, и без
  возврата прежнего значения любое ожидание блокировки в самой команде (очередь
  подписантов наряда FOR UPDATE, уникальность активной смены) обрывалось через
  секунду с 55P03 (опыт на PostgreSQL: 1004 мс).
*/
const claimInput = {
  tenantId: 'tenant-a', actorId: 'actor-1', scope: 'scope', key: 'key-1',
  requestHash: new Uint8Array(32), expiresAt: new Date('2099-01-01T00:00:00Z'),
};

/** Хронология обращений к базе: что и в каком порядке отправлено. */
function setup(inserted: Array<{id: string}>, previous: string) {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const text = (strings: TemplateStringsArray) => strings.join('?').replace(/\s+/g, ' ').trim();
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(text(strings)); params.push(values); return 1;
    }),
    $queryRaw: vi.fn(async (first: unknown, ...values: unknown[]) => {
      const sql = Array.isArray(first)
        ? text(first as unknown as TemplateStringsArray)
        : String((first as {sql?: string}).sql ?? '').replace(/\s+/g, ' ').trim();
      calls.push(sql); params.push(values);
      return sql.includes('current_setting') ? [{previous}] : inserted;
    }),
  };
  return {calls, params, repository: new PrismaCommandIdempotencyRepository(tx as never)};
}

const indexOfInsert = (calls: string[]) => calls.findIndex((sql) => sql.includes('INSERT INTO "IdempotencyKey"'));
const settings = (calls: string[]) => calls
  .map((sql, index) => ({sql, index}))
  .filter(({sql}) => sql.includes("set_config('lock_timeout'"));

describe('PrismaCommandIdempotencyRepository.tryClaim: lock_timeout', () => {
  it('читает прежнее значение, ставит секунду на claim и возвращает прежнее после вставки', async () => {
    const {calls, params, repository} = setup([{id: 'k1'}], '30s');

    expect(await repository.tryClaim(claimInput)).toBe(true);

    const [limit, restore] = settings(calls);
    expect(calls[0]).toContain("current_setting('lock_timeout')");
    expect(limit.sql).toContain("'1000ms'");
    expect(limit.index).toBeLessThan(indexOfInsert(calls));
    expect(restore.index).toBeGreaterThan(indexOfInsert(calls));
    expect(params[restore.index]).toEqual(['30s']);
  });

  it('возвращает прежнее значение и когда ключ уже занят', async () => {
    const {calls, params, repository} = setup([], '0');

    expect(await repository.tryClaim(claimInput)).toBe(false);

    const [, restore] = settings(calls);
    expect(restore.index).toBe(calls.length - 1);
    expect(params[restore.index]).toEqual(['0']);
  });

  it('действует только в пределах транзакции: set_config с третьим аргументом true', async () => {
    const {calls, repository} = setup([{id: 'k1'}], '0');
    await repository.tryClaim(claimInput);
    for (const {sql} of settings(calls)) expect(sql).toMatch(/true\)/);
  });
});
