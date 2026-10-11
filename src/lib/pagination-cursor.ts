/**
 * Cursor-based Pagination Utility
 *
 * Provides type-safe cursor-based pagination helpers for API routes.
 * Solves the "silent data truncation" problem of offset-based pagination.
 *
 * Usage in API route:
 *   const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
 *   const items = await db.report.findMany({
 *     cursor: pagination.cursor ? { id: pagination.cursor } : undefined,
 *     take: pagination.take,
 *     skip: pagination.cursor ? 1 : 0,
 *     orderBy: { createdAt: 'desc' },
 *   });
 *   return NextResponse.json({
 *     data: items,
 *     nextCursor: pagination.getNextCursor(items),
 *     total: await db.report.count({ where }),
 *   });
 */

export interface CursorPaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export interface CursorPaginationResult {
  cursor: string | null;
  take: number;
  /**
   * Calculate nextCursor from the fetched items.
   * Returns null if there are no more items.
   */
  getNextCursor: <T extends { id: string }>(items: T[]) => string | null;
}

export function parseCursorPagination(
  request: Request,
  options: CursorPaginationOptions = {}
): CursorPaginationResult {
  const { defaultLimit = 50, maxLimit = 100 } = options;

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || null;
  const limitParam = url.searchParams.get('limit');
  const requestedLimit = Number(limitParam ?? defaultLimit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit;
  const take = Math.min(limit, maxLimit);

  return {
    cursor,
    take,
    getNextCursor: <T extends { id: string }>(items: T[]): string | null => {
      if (items.length > take) {
        // Remove the extra item used for cursor detection
        items.pop();
        return items[items.length - 1]?.id || null;
      }
      return null;
    },
  };
}

/**
 * Response shape for paginated endpoints.
 */
export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  total?: number;
}

/** Полный список для форм: курсор ответа, а не размер страницы, определяет конец. */
export async function loadAllPages<T>(
  url: string,
  collection: string,
  loadPage: (url: string) => Promise<{ data?: T[]; nextCursor?: string | null; [key: string]: unknown }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let nextUrl = url;
  for (;;) {
    signal?.throwIfAborted();
    const page = await loadPage(nextUrl);
    const rows = page.data ?? page[collection] ?? [];
    if (!Array.isArray(rows)) throw new Error('Не удалось прочитать список');
    items.push(...rows as T[]);
    if (!page.nextCursor) return items;
    if (seen.has(page.nextCursor)) throw new Error('Не удалось загрузить следующую страницу');
    seen.add(page.nextCursor);
    const [pathname, search] = url.split('?');
    const params = new URLSearchParams(search);
    params.set('cursor', page.nextCursor);
    nextUrl = `${pathname}?${params.toString()}`;
  }
}
