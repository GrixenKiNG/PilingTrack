import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

describe('proxy CSP nonce (C-4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeReq(path = '/') {
    return new NextRequest(`http://localhost:3000${path}`);
  }

  function getCsp(response: Response): string {
    return response.headers.get('content-security-policy') ?? '';
  }

  it('sets a Content-Security-Policy response header on HTML routes', () => {
    const res = proxy(makeReq());
    expect(getCsp(res)).not.toBe('');
  });

  it('does NOT set CSP on /api routes (those keep their own headers)', () => {
    const res = proxy(makeReq('/api/health'));
    expect(getCsp(res)).toBe('');
  });

  it("CSP script-src uses a per-request nonce, not 'unsafe-inline'", () => {
    const csp = getCsp(proxy(makeReq()));

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
    const nonce1 = getCsp(proxy(makeReq())).match(/'nonce-([^']+)'/)?.[1];
    const nonce2 = getCsp(proxy(makeReq())).match(/'nonce-([^']+)'/)?.[1];
    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toBe(nonce2);
  });

  it('does NOT include unsafe-eval in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const csp = getCsp(proxy(makeReq()));
    expect(csp).not.toMatch(/(^|[^-])'unsafe-eval'/);
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  it('allows unsafe-eval in development (React Refresh / HMR)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = getCsp(proxy(makeReq()));
    expect(csp).toContain("'unsafe-eval'");
  });

  it("dev script-src drops strict-dynamic so 'self' authorizes /_next/static chunks", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const scriptSrc = getCsp(proxy(makeReq()))
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src '));

    expect(scriptSrc).toBeDefined();
    // strict-dynamic would make the browser ignore 'self' and block dev chunks.
    expect(scriptSrc).not.toContain("'strict-dynamic'");
    expect(scriptSrc).toContain("'self'");
    // 'unsafe-inline' is only effective with no nonce-source present.
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toMatch(/'nonce-/);
  });

  it('keeps object-src none and frame-ancestors self', () => {
    const csp = getCsp(proxy(makeReq()));
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
  });
});
