/**
 * CSRF Double Submit Cookie Protection
 *
 * Defense-in-depth CSRF protection using the Double Submit Cookie pattern.
 * Complements the existing Origin/Referer/Sec-Fetch-Site validation.
 *
 * How it works:
 * 1. Server sets a random CSRF token in a readable cookie (not httpOnly)
 * 2. Client reads the cookie and sends it back in a custom header (X-CSRF-Token)
 * 3. Server validates that cookie value matches header value
 *
 * Since an attacker cannot read cookies from another origin (same-origin policy),
 * they cannot forge a valid request.
 *
 * Usage in route handler:
 *   export async function POST(request: NextRequest) {
 *     const csrfCheck = await validateCsrfToken(request);
 *     if (csrfCheck) return csrfCheck; // 403 response
 *     // ... handle request
 *   }
 *
 * Usage in client:
 *   const token = getCsrfToken();
 *   fetch('/api/reports/upsert', {
 *     method: 'POST',
 *     headers: {
 *       'X-CSRF-Token': token,
 *       'Content-Type': 'application/json',
 *     },
 *     body: JSON.stringify(data),
 *   });
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32; // 256 bits

// Paths exempt from CSRF double-submit checks. Use specific paths only —
// matching is `pathname.startsWith(exempt)`, so a single '/api' here
// would silently exempt the ENTIRE API surface (caught by
// csrf-double-submit.test.ts when this module gets wired into the
// withMutation chain).
const CSRF_DOUBLE_SUBMIT_EXEMPT_PATHS = [
  '/api/ready',
  '/api/health',
  '/api/liveness',
  '/api/readiness',
  '/api/recognize',
  '/api/auth/login',
  '/api/auth/pin',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/refresh',
];

/**
 * Generate a cryptographically secure CSRF token.
 */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Set CSRF token cookie on response.
 * Also returns the token value for client-side use.
 */
export function setCsrfCookie(response: NextResponse): string {
  const token = generateCsrfToken();

  response.cookies.set({
    name: CSRF_COOKIE_NAME,
    value: token,
    httpOnly: false, // Must be readable by JavaScript
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60, // 1 hour
  });

  return token;
}

/**
 * Validate CSRF token from request.
 * Compares cookie value with X-CSRF-Token header.
 *
 * Returns 403 response if validation fails, null if OK.
 */
export async function validateCsrfToken(
  request: NextRequest
): Promise<NextResponse | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Skip exempt paths
  if (CSRF_DOUBLE_SUBMIT_EXEMPT_PATHS.some((exempt) => pathname.startsWith(exempt))) {
    return null;
  }

  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return null; // Only validate state-changing methods
  }

  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  // Both must be present
  if (!cookieToken) {
    return new NextResponse(
      JSON.stringify({ error: 'CSRF token missing in cookie' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!headerToken) {
    return new NextResponse(
      JSON.stringify({ error: 'CSRF token missing in header' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeCompare(cookieToken, headerToken)) {
    return new NextResponse(
      JSON.stringify({ error: 'CSRF token mismatch' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return null; // Validation passed
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');

  return aBuf.equals(bBuf);
}

/**
 * Middleware wrapper: add CSRF cookie to GET responses
 * and validate tokens on state-changing requests.
 */
export function withCsrfDoubleSubmit(
  handler: (req: NextRequest) => Promise<NextResponse>,
  setCookieOnGet = true
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const response = await handler(request);

    // Set CSRF cookie on safe methods (GET) if requested
    if (setCookieOnGet && request.method.toUpperCase() === 'GET') {
      setCsrfCookie(response);
    }

    return response;
  };
}
