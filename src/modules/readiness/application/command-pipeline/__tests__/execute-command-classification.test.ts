import {describe, expect, it, vi} from 'vitest';
import {executeIdempotentCommand} from '../execute-command';
import {hashCommandRequest} from '../idempotency';

/*
  Какую ошибку claim считать «такая же команда ещё выполняется», а какую — нет
  (разбор lock_timeout, 16.10.2026). Раньше любой P2010 становился
  COMMAND_IN_PROGRESS: настоящая SQL-ошибка маскировалась под «команда
  выполняется», а серализационный сбой 40001 не доходил до оболочки транзакции,
  которая повторила бы запрос и на повторе вернула бы уже сохранённый ответ.
*/
const hash = hashCommandRequest({
  method: 'POST', routeTemplate: '/api/readiness/items/:id/start',
  pathIds: {id: 'a'}, body: {expectedVersion: 1}, expectedVersion: 1, actorId: 'actor-1',
});

const adapterError = (shell: string, originalCode: string) => ({
  code: shell, meta: {driverAdapterError: {cause: {originalCode}}},
});

const run = (tryClaim: () => Promise<boolean>, execute = vi.fn()) => executeIdempotentCommand({
  repository: {tryClaim: vi.fn(tryClaim), find: vi.fn(), complete: vi.fn()},
  tenantId: 't', actorId: 'a', scope: 's', key: '1234567890abcdef', requestHash: hash, execute,
});

describe('executeIdempotentCommand: классификация ошибок', () => {
  it.each(['P2010', 'P2039'])('таймаут блокировки при claim под оболочкой %s — «команда выполняется»', async (shell) => {
    await expect(run(() => Promise.reject(adapterError(shell, '55P03'))))
      .rejects.toMatchObject({code: 'COMMAND_IN_PROGRESS', status: 409, headers: {'Retry-After': '1'}});
  });

  it('прежний вид кода (meta.code) тоже понимается', async () => {
    await expect(run(() => Promise.reject({meta: {code: '55P03'}})))
      .rejects.toMatchObject({code: 'COMMAND_IN_PROGRESS'});
  });

  it.each(['40001', '40P01'])('серализационный сбой или взаимная блокировка %s при claim уходит наружу на повтор транзакции', async (sqlstate) => {
    const error = adapterError('P2010', sqlstate);
    await expect(run(() => Promise.reject(error))).rejects.toBe(error);
  });

  it('настоящая SQL-ошибка при claim не маскируется под «команда выполняется»', async () => {
    const error = adapterError('P2010', '42601');
    await expect(run(() => Promise.reject(error))).rejects.toBe(error);
    const bare = {code: 'P2010'};
    await expect(run(() => Promise.reject(bare))).rejects.toBe(bare);
  });

  it('ошибка самой команды, в том числе таймаут блокировки, идёт наружу как есть', async () => {
    const error = adapterError('P2039', '55P03');
    await expect(run(() => Promise.resolve(true), vi.fn().mockRejectedValue(error))).rejects.toBe(error);
  });
});
