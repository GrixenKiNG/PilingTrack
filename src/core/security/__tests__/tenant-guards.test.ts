import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  info: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    idempotencyKey: {deleteMany: mocks.deleteMany},
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
  },
}));
vi.mock('@/lib/logger', () => ({logger: {info: mocks.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn()}}));

import {cleanupExpiredKeys} from '../idempotency';
import {withTenantContext} from '../tenant-enforcement';

beforeEach(() => vi.clearAllMocks());

describe('очистка ключей повторной отправки', () => {
  it('удаляет просроченные и старше семи дней и сообщает число', async () => {
    mocks.deleteMany.mockResolvedValueOnce({count: 5});
    expect(await cleanupExpiredKeys()).toBe(5);
    const where = mocks.deleteMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0].expiresAt.lt).toBeInstanceOf(Date);
    const age = Date.now() - where.OR[1].createdAt.lt.getTime();
    expect(age).toBeGreaterThan(7 * 86_400_000 - 5_000);
    expect(age).toBeLessThan(7 * 86_400_000 + 5_000);
    expect(mocks.info).toHaveBeenCalledWith('Cleaned up expired idempotency keys', {count: 5});
  });

  it('когда удалять нечего, в журнал не пишет', async () => {
    mocks.deleteMany.mockResolvedValueOnce({count: 0});
    expect(await cleanupExpiredKeys()).toBe(0);
    expect(mocks.info).not.toHaveBeenCalled();
  });
});

describe('транзакция с организацией', () => {
  it('без организации отказывает: не выполняет ничего', async () => {
    const work = vi.fn();
    await expect(withTenantContext('', work)).rejects.toMatchObject({status: 500});
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('первым действием выставляет организацию внутри транзакции, затем работает', async () => {
    const order: string[] = [];
    const tx = {$executeRaw: vi.fn(async () => { order.push('set_config'); })};
    mocks.transaction.mockImplementation(async (run: (t: typeof tx) => Promise<unknown>) => run(tx));
    const result = await withTenantContext('orion', async (t) => {
      order.push('work');
      expect(t).toBe(tx);
      return 'готово';
    });
    expect(result).toBe('готово');
    expect(order).toEqual(['set_config', 'work']);
    const [strings, tenant] = tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(strings.join('?')).toContain("set_config('app.current_tenant'");
    expect(tenant).toBe('orion');
  });
});
