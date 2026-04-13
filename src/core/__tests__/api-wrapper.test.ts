/**
 * API Wrapper — Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withApi, withMutation } from '../api-wrapper';

// Mock ServiceError
vi.mock('@/services/service-error', () => ({
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ServiceError';
    }
  },
}));

// Mock CircuitOpenError
vi.mock('@/core/infrastructure/circuit-breakers', () => ({
  CircuitOpenError: class CircuitOpenError extends Error {
    retryAfterMs: number;
    constructor(serviceName: string, retryAfterMs: number) {
      super(`Circuit breaker OPEN for ${serviceName}`);
      this.retryAfterMs = retryAfterMs;
      this.name = 'CircuitOpenError';
    }
  },
}));

import { ServiceError } from '@/services/service-error';
import { CircuitOpenError } from '@/core/infrastructure/circuit-breakers';

function mockRequest(): NextRequest {
  return new NextRequest('http://localhost/api/test');
}

describe('withApi', () => {
  it('should pass through successful responses', async () => {
    const handler = withApi(async () => NextResponse.json({ ok: true }));
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('should catch ServiceError and return its status', async () => {
    const handler = withApi(async () => {
      throw new ServiceError('Not authorized', 403);
    });
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('Not authorized');
  });

  it('should map Prisma P2025 to 404', async () => {
    const handler = withApi(async () => {
      const err = new Error('Record not found') as any;
      err.code = 'P2025';
      throw err;
    });
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('should map Prisma P2002 to 409', async () => {
    const handler = withApi(async () => {
      const err = new Error('Unique constraint failed') as any;
      err.code = 'P2002';
      throw err;
    });
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Unique constraint failed');
  });

  it('should return 500 for unknown Prisma codes', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withApi(async () => {
      const err = new Error('Unknown') as any;
      err.code = 'P9999';
      throw err;
    });
    const res = await handler(mockRequest());

    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it('should return 500 for generic errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withApi(async () => {
      throw new Error('something broke');
    });
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
    consoleSpy.mockRestore();
  });

  it('should map CircuitOpenError to 503', async () => {
    const handler = withApi(async () => {
      throw new CircuitOpenError('database', 15000);
    });
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe('Service temporarily unavailable');
    expect(body.retryAfter).toBe(15);
    expect(res.headers.get('Retry-After')).toBe('15');
  });

  it('should log errors with domain context', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withApi(
      async () => { throw new Error('fail'); },
      { domain: 'reports' }
    );
    await handler(mockRequest());

    expect(consoleSpy).toHaveBeenCalledWith(
      '[API reports]',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it('should pass through extra arguments (dynamic route params)', async () => {
    const handler = withApi(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params;
      return NextResponse.json({ id });
    });
    const res = await handler(mockRequest(), { params: Promise.resolve({ id: 'eq-123' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('eq-123');
  });
});

describe('withMutation', () => {
  it('should behave identically to withApi', async () => {
    const handler = withMutation(async () => {
      throw new ServiceError('Forbidden', 403);
    });
    const res = await handler(mockRequest());

    expect(res.status).toBe(403);
  });
});
