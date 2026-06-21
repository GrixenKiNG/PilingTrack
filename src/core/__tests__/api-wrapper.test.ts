/**
 * API Wrapper — Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withApi, withMutation } from '../api-wrapper';

// Mock ServiceError
vi.mock('@/lib/service-error', () => ({
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

// Mock CSRF — pass by default
vi.mock('@/lib/csrf-protection', () => ({
  withCsrf: vi.fn(() => null),
}));

// Mock rate limiter — allow by default
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: vi.fn(() => Promise.resolve({ allowed: true, remaining: 99 })) },
  getRateLimitIdentifier: vi.fn(() => 'test-ip'),
}));

import { ServiceError } from '@/lib/service-error';
import { CircuitOpenError } from '@/core/infrastructure/circuit-breakers';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter } from '@/lib/rate-limiter';

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

  it('should cache GET responses when cache is enabled', async () => {
    const calls = vi.fn(async () => NextResponse.json({ ok: true, nonce: Date.now() }));
    const handler = withApi(calls, { domain: 'api-wrapper-cache-test', cache: true, cacheTTL: 60_000 });

    const res1 = await handler(mockRequest());
    const body1 = await res1.json();
    const res2 = await handler(mockRequest());
    const body2 = await res2.json();

    expect(calls).toHaveBeenCalledTimes(1);
    expect(body1.ok).toBe(true);
    expect(body2.ok).toBe(true);
    expect(body2.nonce).toBe(body1.nonce);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
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

    const logged = consoleSpy.mock.calls.map(c => String(c[0])).join('');
    expect(logged).toContain('"domain":"reports"');
    expect(logged).toContain('"error":"fail"');
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
  it('should pass through when CSRF and rate limit pass', async () => {
    const handler = withMutation(async () => NextResponse.json({ ok: true }));
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('should return 403 when CSRF check fails', async () => {
    vi.mocked(withCsrf).mockReturnValueOnce(
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
    const handler = withMutation(async () => NextResponse.json({ ok: true }));
    const res = await handler(mockRequest());

    expect(res.status).toBe(403);
  });

  it('should return 429 when rate limit exceeded', async () => {
    vi.mocked(rateLimiter.check).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfter: 30,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    } as any);
    const handler = withMutation(async () => NextResponse.json({ ok: true }));
    const res = await handler(mockRequest());
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe('Too many requests');
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('should still catch ServiceError from handler', async () => {
    const handler = withMutation(async () => {
      throw new ServiceError('Forbidden', 403);
    });
    const res = await handler(mockRequest());

    expect(res.status).toBe(403);
  });
});
