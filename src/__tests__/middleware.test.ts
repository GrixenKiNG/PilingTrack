import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

describe('middleware (CSP nonce — C-4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeReq() {
    return new NextRequest('http://localhost:3000/');
  }

  function getCsp(response: Response): string {
    return response.headers.get('content-security-policy') ?? '';
  }

  it('sets a Content-Security-Policy response header', () => {
    const res = middleware(makeReq());
    expect(getCsp(res)).not.toBe('');
  });

  it("CSP script-src uses a per-request nonce, not 'unsafe-inline'", () => {
    const csp = getCsp(middleware(makeReq()));

    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src '));

    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it('uses a fresh nonce on every request', () => {
    const nonce1 = getCsp(middleware(makeReq())).match(/'nonce-([^']+)'/)?.[1];
    const nonce2 = getCsp(middleware(makeReq())).match(/'nonce-([^']+)'/)?.[1];
    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toBe(nonce2);
  });

  it('does NOT include unsafe-eval in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const csp = getCsp(middleware(makeReq()));
    expect(csp).not.toMatch(/(^|[^-])'unsafe-eval'/);
    // wasm-unsafe-eval is intentionally allowed (WebAssembly support).
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  it('allows unsafe-eval in development (React Refresh / HMR)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = getCsp(middleware(makeReq()));
    expect(csp).toContain("'unsafe-eval'");
  });

  it('keeps object-src none and frame-ancestors self', () => {
    const csp = getCsp(middleware(makeReq()));
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });
});
