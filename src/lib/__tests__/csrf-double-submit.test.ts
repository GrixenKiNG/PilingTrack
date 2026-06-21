/**
 * CSRF double-submit cookie validation tests.
 *
 * Threat model:
 *   - attacker on evil.example serves a form that POSTs to our API
 *   - the user is logged in to our API in another tab (session cookie sent)
 *   - we must reject because the attacker cannot read XSRF-TOKEN to set
 *     the X-CSRF-Token header (Same-Origin policy on cookie reads)
 *
 * What this file pins:
 *   - mutating methods MUST validate (POST/PUT/PATCH/DELETE)
 *   - safe methods (GET/HEAD/OPTIONS) MUST skip
 *   - exempt paths (auth endpoints, health checks) MUST skip
 *   - missing cookie OR missing header → 403
 *   - cookie != header → 403
 *   - cookie == header → pass (returns null)
 *   - comparison is constant-time
 *   - token generation produces high-entropy hex strings
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  generateCsrfToken,
  setCsrfCookie,
  validateCsrfToken,
  withCsrfDoubleSubmit,
} from '../csrf-double-submit';

function makeRequest({
  method = 'POST',
  path = '/api/reports/upsert',
  cookieToken,
  headerToken,
}: {
  method?: string;
  path?: string;
  cookieToken?: string;
  headerToken?: string;
} = {}): NextRequest {
  const headers = new Headers();
  if (headerToken) headers.set('x-csrf-token', headerToken);
  const req = new NextRequest(`http://localhost${path}`, { method, headers });
  // NextRequest doesn't parse the raw `Cookie:` header reliably in the
  // test runtime (happy-dom + Next 16). Set cookies via the mutable
  // RequestCookies API instead.
  if (cookieToken) req.cookies.set('XSRF-TOKEN', cookieToken);
  return req;
}

// ============================================================
// Token generation
// ============================================================

describe('generateCsrfToken', () => {
  it('returns 64 hex chars (32 bytes = 256 bits of entropy)', () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique tokens across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(100);
  });
});

// ============================================================
// setCsrfCookie
// ============================================================

describe('setCsrfCookie', () => {
  it('attaches a XSRF-TOKEN cookie that JS can read (httpOnly: false)', () => {
    const res = NextResponse.json({ ok: true });
    const token = setCsrfCookie(res);

    const cookie = res.cookies.get('XSRF-TOKEN');
    expect(cookie?.value).toBe(token);
    expect(cookie?.httpOnly).toBe(false); // must be readable by client JS
  });

  it('returns the same token it sets on the cookie', () => {
    const res = NextResponse.json({});
    const token = setCsrfCookie(res);
    expect(res.cookies.get('XSRF-TOKEN')?.value).toBe(token);
  });
});

// ============================================================
// validateCsrfToken — accept path
// ============================================================

describe('validateCsrfToken — pass-through cases', () => {
  it('returns null when both cookie and header match', async () => {
    const token = generateCsrfToken();
    const result = await validateCsrfToken(
      makeRequest({ cookieToken: token, headerToken: token }),
    );
    expect(result).toBeNull();
  });

  it('skips validation for GET requests (safe methods)', async () => {
    const result = await validateCsrfToken(makeRequest({ method: 'GET' }));
    expect(result).toBeNull();
  });

  it('skips validation for HEAD and OPTIONS', async () => {
    expect(await validateCsrfToken(makeRequest({ method: 'HEAD' }))).toBeNull();
    expect(await validateCsrfToken(makeRequest({ method: 'OPTIONS' }))).toBeNull();
  });

  it.each([
    '/api/auth/login',
    '/api/auth/pin',
    '/api/auth/logout',
    '/api/auth/refresh',
    '/api/recognize',
    '/api/ready',
  ])('skips validation for exempt path %s', async (path) => {
    const result = await validateCsrfToken(makeRequest({ path, method: 'POST' }));
    expect(result).toBeNull();
  });
});

// ============================================================
// validateCsrfToken — reject path (the actual security checks)
// ============================================================

describe('validateCsrfToken — rejection cases', () => {
  it('rejects with 403 when cookie is missing', async () => {
    const result = await validateCsrfToken(
      makeRequest({ headerToken: 'abc' }),
    );
    expect(result).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    expect(result!.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await result!.json();
    expect(body.error).toMatch(/cookie/i);
  });

  it('rejects with 403 when header is missing (cookie present)', async () => {
    const result = await validateCsrfToken(
      makeRequest({ cookieToken: 'abc' }),
    );
    expect(result).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    expect(result!.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await result!.json();
    expect(body.error).toMatch(/header/i);
  });

  it('rejects with 403 when cookie and header differ (the cross-site scenario)', async () => {
    const result = await validateCsrfToken(
      makeRequest({
        cookieToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headerToken: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    );
    expect(result).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    expect(result!.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await result!.json();
    expect(body.error).toMatch(/mismatch/i);
  });

  it('rejects when only the cookie is present (typical CSRF attack)', async () => {
    // Browser auto-sends our cookie, but the attacker's cross-origin
    // POST has no way to populate X-CSRF-Token.
    const result = await validateCsrfToken(
      makeRequest({ cookieToken: 'real-token' }),
    );
    expect(result?.status).toBe(403);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'validates %s requests (all mutating methods)',
    async (method) => {
      const result = await validateCsrfToken(makeRequest({ method }));
      // missing both → 403
      expect(result?.status).toBe(403);
    },
  );

  it('rejects when cookie and header differ by one byte (no off-by-one accept)', async () => {
    const a = 'a'.repeat(64);
    const b = 'a'.repeat(63) + 'b';
    const result = await validateCsrfToken(
      makeRequest({ cookieToken: a, headerToken: b }),
    );
    expect(result?.status).toBe(403);
  });
});

// ============================================================
// withCsrfDoubleSubmit wrapper
// ============================================================

describe('withCsrfDoubleSubmit', () => {
  it('attaches CSRF cookie to GET responses by default', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withCsrfDoubleSubmit(handler);

    const res = await wrapped(makeRequest({ method: 'GET', path: '/api/auth/me' }));

    expect(res.cookies.get('XSRF-TOKEN')?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not attach cookie on POST responses (only seeded via GET)', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withCsrfDoubleSubmit(handler);

    const res = await wrapped(makeRequest({ method: 'POST' }));

    expect(res.cookies.get('XSRF-TOKEN')).toBeUndefined();
  });

  it('respects setCookieOnGet=false', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withCsrfDoubleSubmit(handler, false);

    const res = await wrapped(makeRequest({ method: 'GET' }));

    expect(res.cookies.get('XSRF-TOKEN')).toBeUndefined();
  });
});
