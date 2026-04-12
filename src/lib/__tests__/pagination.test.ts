/**
 * Unit Tests — Cursor-based Pagination
 *
 * Tests pagination query, response building, and edge cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { paginateQuery, buildPaginationResponse } from '@/lib/pagination';

describe('paginateQuery', () => {
  const createMockQuery = (items: Array<{ id: string }>) =>
    vi.fn().mockImplementation(async (args: Record<string, unknown>) => {
      const take = (args.take as number) || 25;
      const skip = (args.skip as number) || 0;
      return items.slice(skip, skip + take);
    });

  it('returns first page without cursor', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `item-${i + 1}` }));
    const mockQuery = createMockQuery(items);

    const result = await paginateQuery(mockQuery, { limit: 25 }, { where: {} });

    expect(result.data).toHaveLength(25);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('item-25');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns no more items when data fits in one page', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i + 1}` }));
    const mockQuery = createMockQuery(items);

    const result = await paginateQuery(mockQuery, { limit: 25 }, { where: {} });

    expect(result.data).toHaveLength(10);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('uses cursor for subsequent pages', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ id: `item-${i + 1}` }));
    const mockQuery = createMockQuery(items);

    const result = await paginateQuery(
      mockQuery,
      { cursor: 'item-25', limit: 25 },
      { where: {} }
    );

    // The mock ignores cursor, but we verify cursor params are passed
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 26,
        cursor: { id: 'item-25' },
        skip: 1,
      })
    );
  });

  it('respects max limit', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `item-${i + 1}` }));
    const mockQuery = createMockQuery(items);

    const result = await paginateQuery(mockQuery, { limit: 500 }, { where: {} });

    // Max limit is 100, so should request 101
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 })
    );
    expect(result.data).toHaveLength(100);
  });

  it('uses default limit when not specified', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `item-${i + 1}` }));
    const mockQuery = createMockQuery(items);

    await paginateQuery(mockQuery, {}, { where: {} });

    // Default limit is 25, so should request 26
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ take: 26 })
    );
  });

  it('handles empty results', async () => {
    const mockQuery = vi.fn().mockResolvedValue([]);

    const result = await paginateQuery(mockQuery, { limit: 25 }, { where: {} });

    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

describe('buildPaginationResponse', () => {
  it('builds standard response', () => {
    const result = {
      data: [{ id: '1' }, { id: '2' }],
      nextCursor: '2',
      hasMore: true,
    };

    const response = buildPaginationResponse(result);

    expect(response).toEqual({
      data: [{ id: '1' }, { id: '2' }],
      pagination: {
        nextCursor: '2',
        hasMore: true,
      },
    });
  });

  it('includes meta when provided', () => {
    const result = {
      data: [],
      nextCursor: null,
      hasMore: false,
    };

    const response = buildPaginationResponse(result, { total: 150, page: 1 });

    expect(response.pagination).toEqual({
      nextCursor: null,
      hasMore: false,
      total: 150,
      page: 1,
    });
  });
});
