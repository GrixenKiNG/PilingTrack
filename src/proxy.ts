/**
 * Next.js Proxy — Global CORS, Security Headers, Tenant Enforcement
 *
 * Runs before matched route handlers and replaces the deprecated
 * `middleware` file convention in Next.js 16+.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ============================================================
// CORS Configuration
// ============================================================

function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  // Development
  origins.push('http://localhost:3000', 'http://127.0.0.1:3000');

  if (process.env.ALLOWED_DEV_ORIGIN) {
    origins.push(process.env.ALLOWED_DEV_ORIGIN);
  }

  // Production
  if (process.env.CORS_ALLOWED_ORIGINS) {
    origins.push(...process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()));
  }

  // If we're behind a proxy, trust the Host header
  if (process.env.NEXT_PUBLIC_APP_URL) {
    origins.push(process.env.NEXT_PUBLIC_APP_URL);
  }

  return origins;
}

function isOriginAllowed(origin: string, allowed: string[]): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return false;
  }

  return allowed.some(a => {
    if (a === origin) return true;
    if (a.startsWith('*.')) {
      const suffix = a.slice(2); // strip "*."
      // Match subdomains (foo.example.com) but NOT the apex (example.com)
      // and NOT lookalikes (evilexample.com).
      return originHost.endsWith(`.${suffix}`);
    }
    return false;
  });
}

// ============================================================
// Security Headers
// ============================================================

function addSecurityHeaders(response: NextResponse): NextResponse {
  // Already set in next.config.ts, but reinforce here for Proxy runtime
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

  return response;
}

// ============================================================
// Tenant Enforcement
// ============================================================

/**
 * Enforce multi-tenant mode:
 * - If MULTI_TENANT_MODE=true, require X-Tenant-ID header or session tenant
 * - Pass tenant context to downstream handlers via X-Tenant-ID header
 */
function enforceTenant(request: NextRequest, response: NextResponse): NextResponse {
  const mtm = process.env.MULTI_TENANT_MODE;
  const isMultiTenant = mtm === 'multi' || mtm === 'true';

  if (!isMultiTenant) {
    // Single-tenant mode — no enforcement needed
    return response;
  }

  // Extract tenant ID from header (set by reverse proxy or client)
  const headerTenantId = request.headers.get('x-tenant-id');

  // Extract from subdomain (e.g., acme.pilingtrack.ru → tenant=acme)
  const host = request.headers.get('host') || '';
  let subdomainTenant: string | null = null;

  if (process.env.TENANT_DOMAIN) {
    const domainPattern = new RegExp(`\\.${process.env.TENANT_DOMAIN.replace('.', '\\.')}$`);
    const match = host.match(domainPattern);
    if (match) {
      subdomainTenant = host.replace(domainPattern, '');
      // Skip common subdomains
      if (['www', 'api', 'app'].includes(subdomainTenant)) {
        subdomainTenant = null;
      }
    }
  }

  const tenantId = headerTenantId || subdomainTenant;

  if (!tenantId) {
    // In multi-tenant mode, require tenant identification
    // Allow health/readiness endpoints without tenant
    const pathname = request.nextUrl.pathname;
    const publicPaths = ['/api/health', '/api/ready', '/api/readiness', '/api/liveness'];
    if (!publicPaths.includes(pathname)) {
      return NextResponse.json(
        { error: 'Tenant ID required. Provide X-Tenant-ID header or use subdomain.' },
        { status: 403 }
      );
    }
  }

  // Pass tenant context to downstream handlers
  if (tenantId) {
    response.headers.set('x-tenant-id', tenantId);
  }

  return response;
}

// ============================================================
// CSP Nonce (C-4)
// ============================================================

/**
 * Build a per-request nonce CSP for HTML routes. Replaces the previous
 * `script-src 'unsafe-inline'`. Next.js 16 auto-applies the nonce to its
 * own bootstrap/hydration scripts when it sees `x-nonce` on the request.
 *
 * The PDF route owns its own CSP via next.config.ts and is matched by /api,
 * so it bypasses this branch entirely.
 */
function buildNonceCsp(nonce: string): string {
  // Only real `next dev` gets the relaxed policy. Test (NODE_ENV=test) and
  // prod both keep the hardened nonce + strict-dynamic policy — keying off
  // `=== 'development'` (not `!== 'production'`) keeps proxy-csp.test.ts green.
  const isDev = process.env.NODE_ENV === 'development';

  return [
    "default-src 'self'",
    // Prod/test: nonce + strict-dynamic. Note strict-dynamic makes the browser
    // IGNORE 'self', so chunks are authorized only via nonce-propagation (Next
    // stamps the nonce on every SSR'd <script>).
    //
    // Dev: drop strict-dynamic AND the nonce. Next's HMR/React-Refresh runtime
    // loads some chunks (incl. the app/loading.tsx + not-found boundary) without
    // a nonce; with strict-dynamic neutering 'self' those legitimate same-origin
    // /_next/static/chunks/* get CSP-blocked (e.g. on a 404). Without
    // strict-dynamic, 'self' is honored again. 'unsafe-inline' is only effective
    // because no nonce-source is present here (a nonce would suppress it).
    isDev
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    // style-src keeps 'unsafe-inline' — Tailwind/CSS-in-JS rely on it, and
    // inline CSS is materially lower risk than inline JS.
    "style-src 'self' 'unsafe-inline'",
    isDev
      ? "img-src 'self' data: blob: https: http://localhost:*"
      : "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    isDev
      ? "connect-src 'self' https: ws: wss: http://localhost:*"
      : "connect-src 'self' https: ws: wss:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self' blob:",
  ].join('; ');
}

// ============================================================
// Proxy
// ============================================================

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith('/api');

  // -------- API branch: CORS + tenant + reinforced security headers --------
  if (isApi) {
    const origin = request.headers.get('origin');
    const allowedOrigins = getAllowedOrigins();

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      if (origin && isOriginAllowed(origin, allowedOrigins)) {
        const response = new NextResponse(null, { status: 204 });
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Idempotency-Key, X-Tenant-ID');
        response.headers.set('Access-Control-Expose-Headers', 'X-Request-Id, X-Tenant-ID');
        response.headers.set('Access-Control-Max-Age', '86400');
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        return addSecurityHeaders(response);
      }
      return new NextResponse('CORS: Origin not allowed', { status: 403 });
    }

    let response = NextResponse.next();

    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Expose-Headers', 'X-Request-Id, X-Tenant-ID');
    }

    response = addSecurityHeaders(response);
    response = enforceTenant(request, response);

    return response;
  }

  // -------- HTML branch: nonce CSP --------
  // Edge-runtime-safe: Buffer isn't available in edge proxy, but btoa is.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildNonceCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads CSP off the request header to nonce its inline scripts.
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

// Match all paths except static assets and Next internals.
// Prefetch requests are skipped — they don't render scripts and would
// otherwise burn a new nonce per prefetch.
export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon-).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
