import { NextRequest, NextResponse } from 'next/server';

/**
 * Per-request CSP nonce.
 *
 * Replaces the previous static `script-src 'self' 'unsafe-inline'` with a
 * nonce-based policy. Next.js 16 auto-applies this nonce to its own
 * bootstrap/hydration scripts when it sees `x-nonce` on the request and
 * a matching `'nonce-...'` in the response CSP header.
 *
 * `strict-dynamic` lets nonced scripts load further scripts without
 * additional allowlisting, while ignoring host-source allowlists — the
 * net effect is a much tighter policy that's also simpler to maintain.
 *
 * The PDF-preview route owns its own CSP (frame-ancestors 'self') via
 * next.config.ts headers() and is excluded from this matcher.
 */
export function middleware(request: NextRequest) {
  // Edge-runtime-safe: Buffer isn't available in edge middleware, but btoa is.
  const nonce = btoa(crypto.randomUUID());

  const isProd = process.env.NODE_ENV === 'production';

  const csp = [
    "default-src 'self'",
    // Dev needs 'unsafe-eval' for React Refresh / HMR. Prod must NOT have it.
    isProd
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'wasm-unsafe-eval'`,
    // style-src keeps 'unsafe-inline' — Tailwind/CSS-in-JS rely on it, and
    // inline CSS is materially lower risk than inline JS. Removing it is a
    // separate, harder migration.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: ws: wss:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' blob:",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads CSP off the request header to nonce its inline scripts.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     * - /api/*       (route handlers; some need their own CSP, e.g. PDF preview)
     * - /_next/static, /_next/image (static assets — no inline scripts)
     * - /favicon.ico, manifest, sw.js, icons (static files)
     * Skip prefetch requests too — they're internal and don't render scripts,
     * but they would otherwise force a new nonce per prefetch and pollute logs.
     */
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|icon-).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
