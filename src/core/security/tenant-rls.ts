import { AsyncLocalStorage } from 'node:async_hooks';
import { getRequestTenantId } from './tenant-context';

/**
 * Доставка тенанта в Postgres — переменная `app.current_tenant`, которую
 * читают политики RLS.
 *
 * Почему не сессионная переменная. Прод ходит через pgbouncer в режиме
 * транзакционного пулинга: соединение возвращается в пул после каждой
 * транзакции, и следующий запрос уедет на другое. Обычный `SET` там не
 * доживает до запроса, ради которого выставлялся. Поэтому используется
 * `set_config(..., true)` — действует ровно до конца текущей транзакции.
 *
 * Отсюда два разных пути (замерено на живой базе 18.08.2026):
 *
 * 1. Одиночный запрос. Предварить его отдельным `set_config` нельзя — это
 *    была бы отдельная транзакция, и переменная погасла бы раньше, чем до
 *    неё дойдёт запрос. Оба оператора уходят одним пакетом `$transaction([…])`:
 *    пакет и есть одна транзакция. Цена — примерно втрое дольше на запрос
 *    (200 чтений: 139 мс против 405 мс), потому что вместо одного оператора
 *    выполняются четыре: BEGIN, set_config, сам запрос, COMMIT.
 *
 * 2. Запрос внутри уже открытой транзакции. Оборачивать повторно нельзя —
 *    транзакция в транзакции. Переменная выставляется один раз в начале
 *    транзакции, а расширение обязано это распознать и не вмешиваться.
 *
 * Различить эти случаи по клиенту Prisma нельзя, поэтому факт «переменная уже
 * выставлена» держится в отдельном хранилище: оно отличает «тенант известен»
 * от «тенант уже доставлен в базу».
 */
// В globalThis по той же причине, что и хранилище тенанта: сборок несколько,
// экземпляр должен быть один. См. core/security/tenant-context.
const globalForGuc = globalThis as unknown as {
  gucAppliedStorage?: AsyncLocalStorage<true>;
};

const gucApplied: AsyncLocalStorage<true> =
  globalForGuc.gucAppliedStorage ??
  (globalForGuc.gucAppliedStorage = new AsyncLocalStorage<true>());

/** Пометить область, где `app.current_tenant` уже выставлен в базе. */
export function runWithGucApplied<T>(fn: () => T): T {
  return gucApplied.run(true, fn);
}

/** Выставлен ли уже `app.current_tenant` для текущей транзакции. */
export function isGucApplied(): boolean {
  return gucApplied.getStore() === true;
}

/**
 * Нужно ли этому запросу доставлять тенанта самостоятельно.
 *
 * Нет — если тенант неизвестен (не аутентифицированный запрос, воркер,
 * тест) либо переменная уже выставлена объемлющей транзакцией.
 */
export function resolveGucTenantId(): string | null {
  if (isGucApplied()) return null;
  return getRequestTenantId();
}

/** Минимальная часть клиента Prisma, нужная этому модулю. */
interface RlsCapableClient {
  $extends: (extension: unknown) => unknown;
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
  $transaction: (arg: unknown, options?: unknown) => Promise<unknown>;
}

type OperationArgs = {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

/**
 * Обернуть клиент так, чтобы каждая операция над моделью несла тенанта.
 *
 * Операции с неизвестным тенантом проходят как раньше — на этом шаге
 * механизм только доставляет переменную и ничего не запрещает. Обязательность
 * появится вместе с переводом политик в fail-closed, и до тех пор включение
 * не может сломать ни один путь.
 */
export function applyTenantGuc<C extends RlsCapableClient>(client: C): C {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: OperationArgs) {
          const tenantId = resolveGucTenantId();
          if (!tenantId) return query(args);

          const [, result] = (await client.$transaction([
            client.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
            query(args),
          ])) as [unknown, unknown];

          return result;
        },
      },
    },
  }) as C;
}

/**
 * Обернуть транзакцию: выставить тенанта первым оператором и пометить область,
 * чтобы расширение внутрь не лезло.
 *
 * Разбираются обе формы. С функцией — переменная ставится первым оператором
 * внутри, дальше работает исходный код. С массивом — оператор `set_config`
 * просто встаёт в начало пакета, а его результат отбрасывается; расширение
 * туда не достаёт, потому что элементы массива создаются до вызова.
 */
export function wrapTransaction(
  client: RlsCapableClient,
  original: (...callArgs: unknown[]) => Promise<unknown>,
  callArgs: unknown[]
): Promise<unknown> {
  const [first, ...rest] = callArgs;
  const tenantId = resolveGucTenantId();

  if (!tenantId) {
    return original.apply(client, callArgs);
  }

  if (Array.isArray(first)) {
    return original
      .apply(client, [
        [
          client.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
          ...first,
        ],
        ...rest,
      ])
      .then((results) => (results as unknown[]).slice(1));
  }

  if (typeof first !== 'function') {
    return original.apply(client, callArgs);
  }

  const work = first as (tx: unknown) => Promise<unknown>;

  return original.apply(client, [
    async (tx: unknown) => {
      const scopedTx = tx as {
        $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
      };
      await scopedTx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
      return runWithGucApplied(() => work(tx));
    },
    ...rest,
  ]);
}

/**
 * Имена методов сырого SQL. Расширение Prisma до них не достаёт: `$allModels`
 * охватывает только операции над моделями, а `$queryRaw` моделью не является.
 */
const RAW_METHODS = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

/** Метод сырого SQL, которому нужна доставка тенанта? */
export function isRawMethod(name: PropertyKey): boolean {
  return typeof name === 'string' && RAW_METHODS.has(name);
}

/**
 * Обернуть сырой запрос так, чтобы он нёс тенанта.
 *
 * Почему это отдельно от расширения. Сырых запросов в приложении немного, но
 * они обслуживают самые заметные экраны: аналитика по объектам и по технике
 * собирается одним большим SQL ради скорости. Расширение их не перехватывает,
 * поэтому после перевода политик в fail-closed оба экрана молча показали бы
 * ноль (проверено на стенде 19.08.2026: «Объекты» отдавали пустой список при
 * двух живых объектах и 174 отчётах).
 *
 * Приём тот же, что и для моделей: пакет `$transaction([...])` — одна
 * транзакция на `set_config` и сам запрос, потому что `set_config(..., true)`
 * живёт ровно до её конца.
 */
export function wrapRawQuery(
  client: RlsCapableClient,
  original: (...callArgs: unknown[]) => unknown,
  callArgs: unknown[]
): unknown {
  const tenantId = resolveGucTenantId();
  if (!tenantId) return original.apply(client, callArgs);

  return client
    .$transaction([
      client.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
      original.apply(client, callArgs),
    ])
    .then((results) => (results as unknown[])[1]);
}
