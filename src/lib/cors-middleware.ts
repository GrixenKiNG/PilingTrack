/**
 * CORS Middleware for Next.js API Routes
 *
 * Provides proper CORS handling with configurable origins.
 * Must be called at the top of each API route handler.
 *
 * Usage:
 *   import { corsHandler } from '@/lib/cors-middleware';
 *
 *   export async function GET(request: NextRequest) {
 *     const corsResponse = corsHandler(request);
 *     if (corsResponse) return corsResponse; // Handle preflight
 *     // ... handle request
 *   }
 */

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key'];
const EXPOSED_HEADERS = ['X-Request-Id'];
const MAX_AGE = 86400; // 24 hours

/**
 * Get allowed origins from environment.
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];

  // Development origins
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
    if (process.env.ALLOWED_DEV_ORIGIN) {
      origins.push(process.env.ALLOWED_DEV_ORIGIN);
    }
  }

  // Production origins
  if (process.env.CORS_ALLOWED_ORIGINS) {
    origins.push(...process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()));
  }

  return origins;
}

/**
 * Check if origin is allowed.
 */
function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some(allowed => {
    // Exact match
    if (allowed === origin) return true;
    // Wildcard subdomain pattern: https://*.example.com
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1);
      return origin.endsWith(suffix);
    }
    return false;
  });
}

/**
 * Handle CORS for API routes.
 *
 * @returns Response for OPTIONS preflight, or null to continue
 */
export function corsHandler(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null; // Not a CORS request

  const allowedOrigins = getAllowedOrigins();

  // Check if origin is allowed
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return new Response('CORS: Origin not allowed', { status: 403 });
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', '),
        'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
        'Access-Control-Expose-Headers': EXPOSED_HEADERS.join(', '),
        'Access-Control-Max-Age': String(MAX_AGE),
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  return null; // Continue with actual handler
}

/**
 * Apply CORS headers to an existing response.
 */
export function applyCorsHeaders(response: Response, request?: Request): Response {
  const origin = request?.headers.get('origin');
  if (!origin) return response;

  const allowedOrigins = getAllowedOrigins();
  if (!isOriginAllowed(origin, allowedOrigins)) return response;

  // Clone and add CORS headers
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', origin);
  newHeaders.set('Access-Control-Allow-Credentials', 'true');
  newHeaders.set('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
