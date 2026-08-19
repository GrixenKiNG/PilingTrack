import { describe, it, expect, vi } from 'vitest';
import { runWithTenantContext, setRequestTenantId } from '../tenant-context';
import {
  resolveGucTenantId,
  runWithGucApplied,
  isGucApplied,
  isRawMethod,
  wrapRawQuery,
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

describe('обёртка транзакции: массивная форма', () => {
  /**
   * Массивом транзакцию заводит сброс буфера телеметрии. Расширение Prisma
   * туда не достаёт — элементы массива создаются до вызова, — поэтому
   * `set_config` встаёт в начало пакета отдельным оператором.
   */
  const makeClient = () => ({
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: 'set_config',
      sql: strings.join(''),
      value: values[0],
    })),
  });

  it('ставит set_config первым и отдаёт результаты без него', async () => {
    const client = makeClient();
    const original = vi.fn(async (batch: unknown) =>
      (batch as unknown[]).map((_, i) => `результат-${i}`)
    );

    const result = await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      return wrapTransaction(client as never, original as never, [['запрос-1', 'запрос-2']]);
    });

    const sent = original.mock.calls[0][0] as unknown[];
    expect(sent).toHaveLength(3);
    expect((sent[0] as { kind: string }).kind).toBe('set_config');
    expect((sent[0] as { value: unknown }).value).toBe('orion');
    expect(sent.slice(1)).toEqual(['запрос-1', 'запрос-2']);

    // Вызывающий не должен видеть служебный оператор в ответе — иначе
    // индексы результатов уехали бы на единицу.
    expect(result).toEqual(['результат-1', 'результат-2']);
  });

  it('без тенанта пакет уходит нетронутым', async () => {
    const client = makeClient();
    const original = vi.fn(async (_batch: unknown) => ['результат']);

    await wrapTransaction(client as never, original as never, [['запрос']]);

    expect(client.$executeRaw).not.toHaveBeenCalled();
    expect(original.mock.calls[0][0]).toEqual(['запрос']);
  });
});

describe('обёртка сырого SQL', () => {
  /**
   * `$extends({ query: { $allModels } })` охватывает только операции над
   * моделями. `$queryRaw` моделью не является, и без отдельной обёртки
   * аналитика по объектам и по технике под строгими политиками отдавала бы
   * пустоту (проверено на стенде 19.08.2026).
   */
  const makeClient = () => ({
    $executeRaw: vi.fn(() => ({ kind: 'set_config' })),
    $transaction: vi.fn(async (batch: unknown) =>
      (batch as unknown[]).map((_, i) => (i === 0 ? 'служебное' : 'строки')),
    ),
  });

  it('оборачивает запрос в пакет с set_config и отдаёт только его результат', async () => {
    const client = makeClient();
    const original = vi.fn(() => 'сырой-запрос');

    const result = await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      return wrapRawQuery(client as never, original as never, ['SELECT 1']);
    });

    expect(client.$executeRaw).toHaveBeenCalledTimes(1);
    const batch = client.$transaction.mock.calls[0][0] as unknown[];
    expect(batch).toHaveLength(2);
    expect(batch[1]).toBe('сырой-запрос');
    expect(result).toBe('строки');
  });

  it('без тенанта запрос выполняется напрямую', () => {
    const client = makeClient();
    const original = vi.fn(() => 'сырой-запрос');

    const result = wrapRawQuery(client as never, original as never, ['SELECT 1']);

    expect(client.$transaction).not.toHaveBeenCalled();
    expect(result).toBe('сырой-запрос');
  });

  it('узнаёт все четыре метода сырого SQL и не трогает остальные', () => {
    for (const name of ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe']) {
      expect(isRawMethod(name)).toBe(true);
    }
    for (const name of ['$transaction', '$connect', 'user', Symbol('x')]) {
      expect(isRawMethod(name)).toBe(false);
    }
  });
});
