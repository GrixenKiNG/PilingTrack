/**
 * CSRF protection tests for the wrapper used by withMutation.
 *
 * This is the one that ACTUALLY runs on every state-changing API route
 * via core/api-wrapper.ts → withMutation → withCsrf. Defense layers:
 *
 *   1. Sec-Fetch-Site must be same-origin or none (modern browsers)
 *   2. Origin host must match Host
 *   3. Referer host must match Host (if Origin absent)
 *   4. At least one of {Origin, Referer, Sec-Fetch-Site} must be present
 *
 * Exempt path matching is EXACT (not prefix) — a regression to startsWith
 * here would silently disable CSRF for the whole API surface.
 */

import { describe, it, expect } from 'vitest';
import { withCsrf } from '../csrf-protection';

// Why a plain mock object instead of new Request(): the WHATWG fetch spec
// forbids setting Host/Origin/Referer on a Request, so happy-dom and undici
// both silently strip them. That would make every test see "no headers"
// regardless of inputs. withCsrf only touches url, method, and headers.get,
// so a structural mock is correct, well-typed, and exercises the real
// production code path.
function makeRequest({
  method = 'POST',
  path = '/api/reports/upsert',
  host = 'app.orionpiling.ru',
  origin,
  referer,
  secFetchSite,
}: {
  method?: string;
  path?: string;
  host?: string;
  origin?: string;
  referer?: string;
  secFetchSite?: string;
} = {}): Request {
  const h = new Map<string, string>();
  h.set('host', host);
  if (origin !== undefined) h.set('origin', origin);
  if (referer !== undefined) h.set('referer', referer);
  if (secFetchSite !== undefined) h.set('sec-fetch-site', secFetchSite);
  return {
    url: `https://${host}${path}`,
    method,
    headers: { get: (name: string) => h.get(name.toLowerCase()) ?? null },
  } as unknown as Request;
}

// ============================================================
// Method + path gates
// ============================================================

describe('withCsrf — gating', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('skips %s (safe method)', (method) => {
    const res = withCsrf(makeRequest({ method }));
    expect(res).toBeNull();
  });

  it.each([
    '/api/ready',
    '/api/health',
    '/api/recognize',
    '/api/auth/login',
    '/api/auth/pin',
    '/api/auth/me',
  ])('skips %s (exempt path, exact match)', (path) => {
    const res = withCsrf(makeRequest({ path, method: 'POST' }));
    expect(res).toBeNull();
  });

  it('does NOT exempt a path that merely starts with /api (regression guard)', async () => {
    // If someone re-adds prefix matching, /api/reports/upsert would skip
    // CSRF entirely. This test catches that.
    const res = withCsrf(makeRequest({ path: '/api/reports/upsert', method: 'POST' }));
    expect(res).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    expect(res!.status).toBe(403);
  });

  it('does NOT exempt /api/auth/login_with_suffix (no prefix matching on exempts)', async () => {
    const res = withCsrf(makeRequest({ path: '/api/auth/login_evil', method: 'POST' }));
    expect(res).not.toBeNull();
  });
});

// ============================================================
// Sec-Fetch-Site (modern browser signal)
// ============================================================

describe('withCsrf — Sec-Fetch-Site', () => {
  it('passes when sec-fetch-site=same-origin', () => {
    const res = withCsrf(
      makeRequest({ secFetchSite: 'same-origin', origin: 'https://app.orionpiling.ru' }),
    );
    expect(res).toBeNull();
  });

  it('passes when sec-fetch-site=none (top-level navigation)', () => {
    const res = withCsrf(
      makeRequest({ secFetchSite: 'none', origin: 'https://app.orionpiling.ru' }),
    );
    expect(res).toBeNull();
  });

  it('rejects sec-fetch-site=cross-site even with valid Origin (still cross-site!)', async () => {
    const res = withCsrf(
      makeRequest({
        secFetchSite: 'cross-site',
        origin: 'https://evil.example',
        host: 'app.orionpiling.ru',
      }),
    );
    expect(res?.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await res!.json();
    expect(body.error).toMatch(/sec-fetch-site/i);
  });

  it('rejects sec-fetch-site=same-site (still a different subdomain)', () => {
    const res = withCsrf(makeRequest({ secFetchSite: 'same-site' }));
    expect(res?.status).toBe(403);
  });
});

// ============================================================
// Origin
// ============================================================

describe('withCsrf — Origin', () => {
  it('passes when Origin host equals request Host', () => {
    const res = withCsrf(
      makeRequest({ origin: 'https://app.orionpiling.ru', host: 'app.orionpiling.ru' }),
    );
    expect(res).toBeNull();
  });

  it('passes when ports match within Origin and Host', () => {
    const res = withCsrf(
      makeRequest({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
    );
    expect(res).toBeNull();
  });

  it('rejects when Origin host differs from Host (classic CSRF)', async () => {
    const res = withCsrf(
      makeRequest({ origin: 'https://evil.example', host: 'app.orionpiling.ru' }),
    );
    expect(res?.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await res!.json();
    expect(body.error).toMatch(/origin mismatch/i);
  });

  it('rejects an unparseable Origin', async () => {
    const res = withCsrf(makeRequest({ origin: 'not-a-url' }));
    expect(res?.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await res!.json();
    expect(body.error).toMatch(/invalid origin/i);
  });
});

// ============================================================
// Referer (fallback when Origin is absent)
// ============================================================

describe('withCsrf — Referer fallback', () => {
  it('passes when Referer host matches Host (and Origin absent)', () => {
    const res = withCsrf(
      makeRequest({
        referer: 'https://app.orionpiling.ru/operator',
        host: 'app.orionpiling.ru',
      }),
    );
    expect(res).toBeNull();
  });

  it('rejects when Referer host differs from Host', async () => {
    const res = withCsrf(
      makeRequest({ referer: 'https://evil.example/page', host: 'app.orionpiling.ru' }),
    );
    expect(res?.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await res!.json();
    expect(body.error).toMatch(/referer mismatch/i);
  });

  it('does NOT check Referer when Origin is present and valid (avoid redundant rejections)', () => {
    const res = withCsrf(
      makeRequest({
        origin: 'https://app.orionpiling.ru',
        referer: 'https://different.example/whatever',
        host: 'app.orionpiling.ru',
      }),
    );
    expect(res).toBeNull();
  });
});

// ============================================================
// Bare-bones requests (no browser signals at all)
// ============================================================

describe('withCsrf — no headers at all', () => {
  it('rejects requests with NO Origin, NO Referer, NO Sec-Fetch-Site', async () => {
    // Likely curl / a bot / a forged request from a non-browser context.
    const res = withCsrf(makeRequest({ method: 'POST' }));
    expect(res?.status).toBe(403);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const body = await res!.json();
    expect(body.error).toMatch(/missing origin/i);
  });

  it('passes when only Sec-Fetch-Site=same-origin is present', () => {
    // PWA + service worker often strips Origin/Referer but keeps SFS.
    const res = withCsrf(makeRequest({ secFetchSite: 'same-origin' }));
    expect(res).toBeNull();
  });
});
