/**
 * Код PostgreSQL (SQLSTATE) из ошибки Prisma, где бы он ни лежал.
 *
 * Драйверный адаптер (PrismaPg) не поднимает код наверх: настоящий SQLSTATE
 * спрятан в `meta.driverAdapterError.cause.originalCode`, а сверху стоит
 * оболочка — P2010 «Raw query failed» либо P2039. Пока разбирали только оболочку,
 * под одним кодом оказывались и таймаут блокировки (55P03), и серализационный
 * сбой (40001), и ошибка синтаксиса (42601), хотя вести они должны себя по-разному.
 *
 * Внутренний код главнее оболочки; без него — `meta.code`, затем `code`
 * (так читаются ошибки Prisma без адаптера, в том числе P2034).
 */
export function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as {
    code?: string;
    meta?: {code?: string; driverAdapterError?: {cause?: {originalCode?: string}}};
  };
  return candidate.meta?.driverAdapterError?.cause?.originalCode
    ?? candidate.meta?.code
    ?? candidate.code
    ?? null;
}
