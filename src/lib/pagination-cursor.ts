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
  const take = Math.min(parseInt(limitParam || String(defaultLimit), 10), maxLimit);

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
