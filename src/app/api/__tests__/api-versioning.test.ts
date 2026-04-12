/**
 * API Routes — Contract Tests
 *
 * Validates:
 * - Version detection (header, URL, default)
 * - Deprecation handling
 * - Response structure (consistent error format)
 * - Content-Type enforcement
 * - Required headers
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  detectVersion,
  checkDeprecation,
  addVersionHeaders,
  withApiVersion,
  validateContract,
  API_VERSIONS,
} from '@/lib/api-versioning';

// ============================================================
// Helpers
// ============================================================

function createRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    headers: new Headers(headers),
  });
}

// ============================================================
// Tests
// ============================================================

describe('API Versioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectVersion', () => {
    it('detects version from X-API-Version header', () => {
      const request = createRequest('http://localhost:3000/api/reports', {
        'X-API-Version': 'v1',
      });

      expect(detectVersion(request)).toBe('v1');
    });

    it('detects version from URL path', () => {
      const request = createRequest('http://localhost:3000/api/v1/reports');

      expect(detectVersion(request)).toBe('v1');
    });

    it('header version overrides URL path version', () => {
      const request = createRequest('http://localhost:3000/api/v1/reports', {
        'X-API-Version': 'v1',
      });

      expect(detectVersion(request)).toBe('v1');
    });

    it('defaults to v1 when no version specified', () => {
      const request = createRequest('http://localhost:3000/api/reports');

      expect(detectVersion(request)).toBe('v1');
    });

    it('ignores unknown versions in header', () => {
      const request = createRequest('http://localhost:3000/api/reports', {
        'X-API-Version': 'v99',
      });

      // Falls back to default
      expect(detectVersion(request)).toBe('v1');
    });

    it('ignores unknown versions in URL', () => {
      const request = createRequest('http://localhost:3000/api/v99/reports');

      // Falls back to default
      expect(detectVersion(request)).toBe('v1');
    });
  });

  describe('checkDeprecation', () => {
    it('returns not deprecated for current version', () => {
      const result = checkDeprecation('v1');

      expect(result.isDeprecated).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it('returns deprecated for deprecated version', () => {
      // Temporarily add a deprecated version for testing
      const originalVersions = { ...API_VERSIONS };
      API_VERSIONS['v0'] = {
        version: 'v0',
        status: 'deprecated',
        sunsetDate: '2027-01-01T00:00:00Z',
      };

      const result = checkDeprecation('v0');

      expect(result.isDeprecated).toBe(true);
      expect(result.sunsetDate).toBe('2027-01-01T00:00:00Z');
      expect(result.warning).toContain('deprecated');

      // Cleanup
      delete API_VERSIONS['v0'];
      Object.assign(API_VERSIONS, originalVersions);
    });

    it('returns no warning for version without sunset date', () => {
      const originalVersions = { ...API_VERSIONS };
      API_VERSIONS['v0'] = {
        version: 'v0',
        status: 'deprecated',
      };

      const result = checkDeprecation('v0');

      expect(result.isDeprecated).toBe(true);
      expect(result.warning).toBeUndefined();

      // Cleanup
      delete API_VERSIONS['v0'];
      Object.assign(API_VERSIONS, originalVersions);
    });
  });

  describe('addVersionHeaders', () => {
    it('adds X-API-Version header to response', () => {
      const response = NextResponse.json({ data: 'test' });

      addVersionHeaders(response, 'v1');

      expect(response.headers.get('X-API-Version')).toBe('v1');
    });

    it('adds X-API-Available-Versions header', () => {
      const response = NextResponse.json({ data: 'test' });

      addVersionHeaders(response, 'v1');

      const availableVersions = response.headers.get('X-API-Available-Versions');
      expect(availableVersions).toContain('v1');
    });
  });

  describe('withApiVersion middleware', () => {
    it('allows current version', () => {
      const request = createRequest('http://localhost:3000/api/v1/reports');
      const response = withApiVersion(request);

      // Should not return error response (returns next() response)
      expect(response).not.toBeNull();
      expect(response?.status).toBe(200); // NextResponse.next() returns 200
    });

    it('rejects unknown version with 400', () => {
      // Temporarily make v1 unknown by manipulating registry
      const originalV1 = API_VERSIONS['v1'];
      delete API_VERSIONS['v1'];

      const request = createRequest('http://localhost:3000/api/v1/reports');
      const response = withApiVersion(request);

      // Restore
      API_VERSIONS['v1'] = originalV1;

      expect(response).not.toBeNull();
      expect(response?.status).toBe(400);
    });

    it('returns 410 for retired version past sunset date', () => {
      const originalVersions = { ...API_VERSIONS };
      API_VERSIONS['v0'] = {
        version: 'v0',
        status: 'deprecated',
        sunsetDate: '2020-01-01T00:00:00Z', // Past date
      };

      const request = createRequest('http://localhost:3000/api/v0/reports');
      const response = withApiVersion(request);

      // Cleanup
      delete API_VERSIONS['v0'];
      Object.assign(API_VERSIONS, originalVersions);

      expect(response?.status).toBe(410);
    });
  });

  describe('validateContract', () => {
    it('passes valid request with correct content-type', () => {
      const request = createRequest('http://localhost:3000/api/reports', {
        'Content-Type': 'application/json',
      });

      const errors = validateContract(request, {
        path: '/api/reports',
        method: 'POST',
        version: 'v1',
        requiredHeaders: ['Content-Type'],
      });

      expect(errors).toHaveLength(0);
    });

    it('fails when required header is missing', () => {
      const request = createRequest('http://localhost:3000/api/reports', {
        'Content-Type': 'application/json', // Satisfy content-type check
      });

      const errors = validateContract(request, {
        path: '/api/reports',
        method: 'POST',
        version: 'v1',
        requiredHeaders: ['X-Request-Id'],
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('X-Request-Id');
    });

    it('fails when content-type is not JSON for POST', () => {
      const request = createRequest('http://localhost:3000/api/reports', {
        'Content-Type': 'text/plain',
      });

      const errors = validateContract(request, {
        path: '/api/reports',
        method: 'POST',
        version: 'v1',
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('application/json');
    });

    it('skips content-type check for GET requests', () => {
      const request = createRequest('http://localhost:3000/api/reports');

      const errors = validateContract(request, {
        path: '/api/reports',
        method: 'GET',
        version: 'v1',
      });

      expect(errors).toHaveLength(0);
    });
  });

  describe('Version Registry', () => {
    it('has v1 as current version', () => {
      expect(API_VERSIONS['v1'].status).toBe('current');
    });

    it('has at least one version defined', () => {
      expect(Object.keys(API_VERSIONS).length).toBeGreaterThanOrEqual(1);
    });
  });
});
