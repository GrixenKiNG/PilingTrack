import { describe, it, expect, vi } from 'vitest';
import { runWithTenantContext, setRequestTenantId } from '../tenant-context';
import {
  resolveGucTenantId,
  runWithGucApplied,
  isGucApplied,
  wrapTransaction,
} from '../tenant-rls';

describe('доставка тенанта в Postgres — кому она нужна', () => {
  it('без контекста запроса доставлять нечего', () => {
    expect(resolveGucTenantId()).toBeNull();
  });

  it('под известным тенантом доставка нужна', () => {
    runWithTenantContext(() => {
      setRequestTenantId('orion');
      expect(resolveGucTenantId()).toBe('orion');
    });
  });

  /**
   * Ключевое свойство: внутри уже открытой транзакции переменная выставлена
   * один раз, и операции не должны оборачиваться повторно — иначе получится
   * транзакция внутри транзакции.
   */
  it('внутри транзакции повторная доставка не нужна', () => {
    runWithTenantContext(() => {
      setRequestTenantId('orion');
      runWithGucApplied(() => {
        expect(isGucApplied()).toBe(true);
        expect(resolveGucTenantId()).toBeNull();
      });
      // За пределами транзакции — снова нужна.
      expect(resolveGucTenantId()).toBe('orion');
    });
  });
});

describe('обёртка интерактивной транзакции', () => {
  const makeTx = () => ({ $executeRaw: vi.fn().mockResolvedValue(1) });

  it('выставляет тенанта первым оператором и помечает область', async () => {
    const tx = makeTx();
    let gucSeenInside: boolean | null = null;

    const original = vi.fn(async (work: unknown) =>
      (work as (t: unknown) => Promise<unknown>)(tx)
    );

    await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      await wrapTransaction(
        {} as never,
        original as never,
        [
          async () => {
            gucSeenInside = isGucApplied();
            return 'готово';
          },
        ]
      );
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, value] = tx.$executeRaw.mock.calls[0];
    expect((strings as TemplateStringsArray).join('')).toContain('set_config');
    expect(value).toBe('orion');
    expect(gucSeenInside).toBe(true);
  });

  it('без тенанта транзакция уходит нетронутой', async () => {
    const tx = makeTx();
    const original = vi.fn(async (work: unknown) =>
      (work as (t: unknown) => Promise<unknown>)(tx)
    );

    await wrapTransaction({} as never, original as never, [async () => 'готово']);

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('передаёт настройки транзакции дальше без изменений', async () => {
    const tx = makeTx();
    const original = vi.fn(async (...callArgs: unknown[]) =>
      (callArgs[0] as (t: unknown) => Promise<unknown>)(tx)
    );
    const options = { timeout: 10000 };

    await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      await wrapTransaction({} as never, original as never, [async () => 1, options]);
    });

    expect(original.mock.calls[0][1]).toBe(options);
  });

  it('возвращает результат работы, а не результат set_config', async () => {
    const tx = makeTx();
    const original = vi.fn(async (work: unknown) =>
      (work as (t: unknown) => Promise<unknown>)(tx)
    );

    const result = await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      return wrapTransaction({} as never, original as never, [async () => 'значение']);
    });

    expect(result).toBe('значение');
  });
});
