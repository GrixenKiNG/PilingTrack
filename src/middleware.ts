/**
 * Next.js Middleware — Global CORS, Security Headers, Tenant Enforcement
 *
 * Runs on Edge runtime for every request before the route handler.
 *
 * Features:
 * - CORS configuration with wildcard subdomain support
 * - Security headers reinforcement
 * - Tenant context propagation (X-Tenant-ID header → AsyncLocalStorage)
 * - Multi-tenant mode enforcement
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
  return allowed.some(a => {
    if (a === origin) return true;
    if (a.startsWith('*.')) {
      return origin.endsWith(a.slice(1));
    }
    return false;
  });
}

// ============================================================
// Security Headers
// ============================================================

function addSecurityHeaders(response: NextResponse): NextResponse {
  // Already set in next.config.ts, but reinforce here for Edge runtime
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
  const isMultiTenant = process.env.MULTI_TENANT_MODE === 'true';

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
// Middleware
// ============================================================

export function middleware(request: NextRequest) {
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

  // Add CORS headers to actual responses (when origin present)
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

// Match only API routes
export const config = {
  matcher: '/api/:path*',
};
