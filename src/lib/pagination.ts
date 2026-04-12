/**
 * Cursor-based Pagination Utility
 *
 * Provides efficient pagination for large datasets without OFFSET performance issues.
 * Uses the `id` field as the cursor (cuid() ensures lexicographic ordering).
 *
 * Usage:
 *   const result = await paginateQuery(
 *     db.report.findMany,
 *     { cursor: 'abc123', limit: 25, where: { status: 'submitted' } }
 *   );
 */

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Execute a cursor-based pagination query.
 *
 * @param queryFn - Prisma findMany function
 * @param params - Pagination parameters
 * @param baseQuery - Base query options (where, include, orderBy, etc.)
 * @returns Paginated result with next cursor
 */
export async function paginateQuery<T extends { id: string | number }>(
  queryFn: (args: Record<string, unknown>) => Promise<T[]>,
  params: PaginationParams,
  baseQuery: Record<string, unknown>
): Promise<PaginatedResult<T>> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  // Request one extra item to determine if there's more
  const queryArgs = {
    ...baseQuery,
    take: limit + 1,
    ...(params.cursor
      ? {
          cursor: { id: params.cursor },
          skip: 1,
        }
      : {}),
  };

  const items = await queryFn(queryArgs);

  const hasMore = items.length > limit;
  const data = items.slice(0, limit);

  const nextCursor = hasMore && data.length > 0
    ? String(data[data.length - 1].id)
    : null;

  return {
    data,
    nextCursor,
    hasMore,
  };
}

/**
 * Build pagination response for API routes.
 */
export function buildPaginationResponse<T>(
  result: PaginatedResult<T>,
  meta?: Record<string, unknown>
) {
  return {
    data: result.data,
    pagination: {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      ...meta,
    },
  };
}
