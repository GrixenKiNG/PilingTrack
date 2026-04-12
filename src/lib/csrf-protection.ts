/**
 * CSRF Protection — API-level (Node.js runtime)
 *
 * Edge middleware doesn't work on Windows + Turbopack (Next.js 16 upstream issue).
 * This provides defense-in-depth CSRF protection at the route handler level.
 *
 * Defense strategy (multiple layers):
 * 1. Origin header validation (primary)
 * 2. Referer header validation (fallback)
 * 3. Sec-Fetch-Site header validation (modern browsers)
 * 4. Host header validation
 *
 * Usage:
 *   import { withCsrf } from '@/lib/csrf-protection';
 *
 *   export async function POST(request: NextRequest) {
 *     const csrfCheck = withCsrf(request);
 *     if (csrfCheck) return csrfCheck; // 403 NextResponse
 *     // ... handle request
 *   }
 */

import { NextResponse } from 'next/server';

// Paths exempt from CSRF checks.
// Only unauthenticated entry-points belong here. Authenticated state-changing
// endpoints (logout, refresh, session-bound mutations) MUST go through CSRF.
const CSRF_EXEMPT_PATHS = [
  '/api/ready',
  '/api/health',
  '/api/recognize',
  '/api/auth/login',
  '/api/auth/pin',
  '/api/auth/me',
];

// Allowed Sec-Fetch-Site values for same-origin requests
const ALLOWED_FETCH_SITES = ['same-origin', 'none'];

/**
 * Check CSRF for state-changing requests.
 * Returns a 403 NextResponse if CSRF validation fails, or null if OK.
 */
export function withCsrf(request: Request): NextResponse | null {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Skip exempt paths (exact match only — prefix matching previously allowed
  // '/api' to exempt every API route, fully disabling CSRF protection)
  if (CSRF_EXEMPT_PATHS.includes(pathname)) {
    return null;
  }

  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return null;
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');
  const secFetchSite = request.headers.get('sec-fetch-site');

  // Layer 1: Sec-Fetch-Site validation (modern browsers, most reliable)
  if (secFetchSite) {
    if (!ALLOWED_FETCH_SITES.includes(secFetchSite)) {
      return NextResponse.json(
        { error: 'CSRF validation failed: invalid sec-fetch-site' },
        { status: 403 }
      );
    }
  }

  // Layer 2: Origin header validation (primary defense)
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { error: 'CSRF validation failed: origin mismatch' },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'CSRF validation failed: invalid origin' },
        { status: 403 }
      );
    }
  }

  // Layer 3: Referer header validation (fallback when Origin is absent)
  if (referer && !origin) {
    try {
      const refererHost = new URL(referer).host;
      if (refererHost !== host) {
        return NextResponse.json(
          { error: 'CSRF validation failed: referer mismatch' },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'CSRF validation failed: invalid referer' },
        { status: 403 }
      );
    }
  }

  // Layer 4: If no Origin, no Referer, and no Sec-Fetch-Site — reject
  // (indicates suspicious request, likely not from a browser)
  if (!origin && !referer && !secFetchSite) {
    return NextResponse.json(
      { error: 'CSRF validation failed: missing origin, referer, and sec-fetch-site' },
      { status: 403 }
    );
  }

  return null;
}
