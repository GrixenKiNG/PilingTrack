import {describe, expect, it, vi} from 'vitest';
import {runReadinessSerializableTransaction} from '../tenant-transaction';

/*
  Таймаут ожидания блокировки (55P03) внутри команды — такая же временная помеха,
  как взаимная блокировка: транзакция уже прервана, её надо повторить целиком, а
  после трёх попыток отдать устойчивый 409, а не общий 500 (разбор lock_timeout,
  16.10.2026). Код лежит под оболочкой драйверного адаптера.
*/
const lockTimeout = (shell: string) => ({code: shell, meta: {driverAdapterError: {cause: {originalCode: '55P03'}}}});

describe('readiness serializable transaction: таймаут блокировки', () => {
  it.each(['P2010', 'P2039'])('повторяет транзакцию целиком при 55P03 под оболочкой %s', async (shell) => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{tenant_id: 'tenant-a'}]),
    };
    const transaction = vi.fn()
      .mockRejectedValueOnce(lockTimeout(shell))
      .mockImplementationOnce(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));

    await expect(runReadinessSerializableTransaction(
      {$transaction: transaction} as never, 'tenant-a', vi.fn().mockResolvedValue('committed'),
    )).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('после трёх таймаутов отдаёт устойчивый 409 без текста базы', async () => {
    const client = {$transaction: vi.fn().mockRejectedValue(lockTimeout('P2039'))};

    await expect(runReadinessSerializableTransaction(client as never, 'tenant-a', vi.fn()))
      .rejects.toMatchObject({code: 'VERSION_CONFLICT', status: 409, headers: {'Retry-After': '1'}});
    expect(client.$transaction).toHaveBeenCalledTimes(3);
  });

  it('настоящая SQL-ошибка не повторяется и не превращается в конфликт', async () => {
    const error = {code: 'P2010', meta: {driverAdapterError: {cause: {originalCode: '42601'}}}};
    const client = {$transaction: vi.fn().mockRejectedValue(error)};

    await expect(runReadinessSerializableTransaction(client as never, 'tenant-a', vi.fn())).rejects.toBe(error);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });
});
