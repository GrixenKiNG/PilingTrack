// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { SerializedPrismaPg } from '../serialized-prisma-pg';

type Adapter = Awaited<ReturnType<PrismaPg['connect']>>;
const sql = { sql: 'SELECT 1', args: [], argTypes: [] };
const rows = { columnNames: ['n'], columnTypes: [0], rows: [[1]] };

function fixture() {
  const transaction = {
    queryRaw: vi.fn().mockResolvedValue(rows),
    executeRaw: vi.fn().mockResolvedValue(1),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  const startTransaction = vi.fn().mockResolvedValue({ ...transaction });
  vi.spyOn(PrismaPg.prototype, 'connect').mockResolvedValue({ startTransaction } as unknown as Adapter);
  return { transaction, startTransaction, factory: new SerializedPrismaPg({}) };
}

afterEach(() => vi.restoreAllMocks());

describe('SerializedPrismaPg', () => {
  it('serializes mixed SQL operations on one transaction', async () => {
    const { transaction, factory } = fixture();
    const first = Promise.withResolvers<typeof rows>();
    transaction.queryRaw.mockReturnValueOnce(first.promise);
    const tx = await (await factory.connect()).startTransaction();
    const a = tx.queryRaw(sql);
    const b = tx.executeRaw(sql);
    const c = tx.queryRaw(sql);
    await vi.waitFor(() => expect(transaction.queryRaw).toHaveBeenCalledTimes(1));
    expect(transaction.executeRaw).not.toHaveBeenCalled();
    first.resolve(rows);
    expect(await Promise.all([a, b, c])).toEqual([rows, 1, rows]);
    expect(transaction.queryRaw).toHaveBeenCalledTimes(2);
  });

  it('allows independent transactions to execute concurrently', async () => {
    const { transaction, startTransaction, factory } = fixture();
    const other = { ...transaction, queryRaw: vi.fn().mockResolvedValue(rows) };
    startTransaction.mockResolvedValueOnce({ ...transaction }).mockResolvedValueOnce(other);
    const first = Promise.withResolvers<typeof rows>();
    transaction.queryRaw.mockReturnValueOnce(first.promise);
    const adapter = await factory.connect();
    const a = await adapter.startTransaction();
    const b = await adapter.startTransaction();
    const pending = a.queryRaw(sql);
    expect(await b.queryRaw(sql)).toEqual(rows);
    first.resolve(rows);
    await pending;
  });

  it('propagates SQL errors and permits rollback SQL afterwards', async () => {
    const { transaction, factory } = fixture();
    const error = new Error('SQL failed');
    transaction.queryRaw.mockRejectedValueOnce(error);
    const tx = await (await factory.connect()).startTransaction();
    await expect(tx.queryRaw(sql)).rejects.toBe(error);
    expect(await tx.executeRaw({ ...sql, sql: 'ROLLBACK' })).toBe(1);
    await tx.rollback();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('waits for pending SQL before returning a client to the pool', async () => {
    const { transaction, factory } = fixture();
    const first = Promise.withResolvers<typeof rows>();
    transaction.queryRaw.mockReturnValueOnce(first.promise);
    const tx = await (await factory.connect()).startTransaction();
    const pending = tx.queryRaw(sql);
    const rollback = tx.rollback();
    await vi.waitFor(() => expect(transaction.queryRaw).toHaveBeenCalledTimes(1));
    expect(transaction.rollback).not.toHaveBeenCalled();
    await expect(tx.queryRaw(sql)).rejects.toThrow('Transaction is closing');
    first.resolve(rows);
    await Promise.all([pending, rollback]);
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('finalizes a transaction once when commit races with rollback', async () => {
    const { transaction, factory } = fixture();
    const tx = await (await factory.connect()).startTransaction();
    await Promise.all([tx.commit(), tx.rollback(), tx.commit()]);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('preserves a finalization error and prevents double release on retry', async () => {
    const { transaction, factory } = fixture();
    const error = new Error('release failed');
    transaction.commit.mockRejectedValueOnce(error);
    const tx = await (await factory.connect()).startTransaction();
    await expect(tx.commit()).rejects.toBe(error);
    await expect(tx.rollback()).rejects.toBe(error);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
