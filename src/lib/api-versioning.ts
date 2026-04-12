/**
 * API Versioning — Middleware + Contract Enforcement
 *
 * Strategy: URL path versioning (/api/v1/..., /api/v2/...)
 *
 * Rules:
 * 1. Unversioned routes (/api/...) are treated as v1 (backward compatible)
 * 2. Version header (X-API-Version) overrides URL path version
 * 3. Deprecated versions return 410 Gone after sunset date
 * 4. Unknown versions return 400 Bad Request
 * 5. Response includes API version headers for client discovery
 *
 * Usage:
 *   Wrap route handlers: withApiVersion(handler, { version: 'v1' })
 *   Or use as middleware in Next.js config
 */

import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// Version Registry
// ============================================================

export interface ApiVersion {
  version: string;
  status: 'current' | 'stable' | 'deprecated';
  sunsetDate?: string; // ISO date when version will be removed
  changelog?: string;
}

export const API_VERSIONS: Record<string, ApiVersion> = {
  v1: {
    version: 'v1',
    status: 'current',
    changelog: 'Initial API version',
  },
  // Future versions:
  // v2: {
  //   version: 'v2',
  //   status: 'stable',
  //   changelog: 'Breaking changes: ...',
  // },
};

export const DEFAULT_API_VERSION = 'v1';

// ============================================================
// Version Detection
// ============================================================

/**
 * Detect API version from request.
 * Priority: X-API-Version header > URL path > default
 */
export function detectVersion(request: NextRequest): string {
  // 1. Check header
  const headerVersion = request.headers.get('X-API-Version');
  if (headerVersion && API_VERSIONS[headerVersion]) {
    return headerVersion;
  }

  // 2. Check URL path (/api/v1/..., /api/v2/...)
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  const urlVersion = pathParts.find((p) => p.startsWith('v') && /^\d+$/.test(p.slice(1)));
  if (urlVersion && API_VERSIONS[urlVersion]) {
    return urlVersion;
  }

  // 3. Default
  return DEFAULT_API_VERSION;
}

// ============================================================
// Deprecation Check
// ============================================================

export function checkDeprecation(version: string): {
  isDeprecated: boolean;
  sunsetDate?: string;
  warning?: string;
} {
  const apiVersion = API_VERSIONS[version];
  if (!apiVersion) {
    return { isDeprecated: false };
  }

  const isDeprecated = apiVersion.status === 'deprecated';
  const sunsetDate = apiVersion.sunsetDate;

  let warning: string | undefined;
  if (isDeprecated && sunsetDate) {
    warning = `API version ${version} is deprecated and will be removed on ${sunsetDate}. Upgrade to the current version.`;
  }

  return { isDeprecated, sunsetDate, warning };
}

// ============================================================
// Version Headers
// ============================================================

export function addVersionHeaders(
  response: NextResponse,
  version: string
): NextResponse {
  const apiVersion = API_VERSIONS[version];

  // Current API version
  response.headers.set('X-API-Version', version);

  // Available versions
  response.headers.set(
    'X-API-Available-Versions',
    Object.values(API_VERSIONS)
      .map((v) => v.version)
      .join(', ')
  );

  // Deprecation header (RFC 8594)
  if (apiVersion?.status === 'deprecated' && apiVersion.sunsetDate) {
    response.headers.set('Sunset', apiVersion.sunsetDate);
    response.headers.set(
      'Deprecation',
      `API version ${version} is deprecated. Sunset date: ${apiVersion.sunsetDate}`
    );
  }

  return response;
}

// ============================================================
// Version Middleware
// ============================================================

/**
 * API versioning middleware.
 * Checks version, rejects unknown/deprecated versions.
 *
 * Usage in route.ts:
 *   export { middleware } from '@/lib/api-versioning';
 *   export async function GET(request: NextRequest) { ... }
 */
export function withApiVersion(request: NextRequest): NextResponse | null {
  const version = detectVersion(request);

  // Unknown version
  if (!API_VERSIONS[version]) {
    return NextResponse.json(
      {
        error: 'Unknown API version',
        message: `Version "${version}" is not supported. Available versions: ${Object.keys(API_VERSIONS).join(', ')}`,
        availableVersions: Object.keys(API_VERSIONS),
      },
      { status: 400 }
    );
  }

  // Deprecated version past sunset
  const { isDeprecated, sunsetDate, warning } = checkDeprecation(version);

  if (isDeprecated && sunsetDate && new Date(sunsetDate) < new Date()) {
    return NextResponse.json(
      {
        error: 'API version retired',
        message: `Version "${version}" was retired on ${sunsetDate}. Please upgrade to a supported version.`,
        availableVersions: Object.keys(API_VERSIONS).filter(
          (v) => API_VERSIONS[v].status !== 'deprecated'
        ),
      },
      { status: 410 }
    );
  }

  // Create response with version headers
  const response = NextResponse.next();
  addVersionHeaders(response, version);

  // Add warning header for deprecated versions
  if (warning) {
    response.headers.set('X-API-Warning', warning);
  }

  return response;
}

// ============================================================
// Contract Validation
// ============================================================

export interface ApiContract {
  path: string;
  method: string;
  version: string;
  requestSchema?: Record<string, unknown>;
  responseSchema?: Record<string, unknown>;
  requiredHeaders?: string[];
}

/**
 * Validate request against API contract.
 * Returns validation errors (empty array = valid).
 */
export function validateContract(
  request: NextRequest,
  contract: ApiContract
): string[] {
  const errors: string[] = [];

  // Check required headers
  if (contract.requiredHeaders) {
    for (const header of contract.requiredHeaders) {
      if (!request.headers.has(header)) {
        errors.push(`Missing required header: ${header}`);
      }
    }
  }

  // Check content-type for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(contract.method.toUpperCase())) {
    const contentType = request.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      errors.push('Content-Type must be application/json');
    }
  }

  return errors;
}
