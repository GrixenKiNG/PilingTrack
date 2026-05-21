/**
 * tenant-context-service tests.
 *
 * Multi-tenancy is currently disabled on prod (single tenant 'orion'), but
 * this file pins the contract that decides whether it's enabled and where
 * the tenantId comes from. When a second tenant ships, the values below
 * are what every request goes through — drift here is a data-isolation
 * incident waiting to happen.
 *
 * Contract:
 *   isMultiTenantMode():
 *     - MULTI_TENANT_MODE='multi'  → true (canonical)
 *     - MULTI_TENANT_MODE='true'   → true (legacy spelling)
 *     - anything else / unset      → false
 *
 *   resolveTenantContext(request):
 *     single mode:
 *       - returns DEFAULT_TENANT_ID with source='default'
 *       - returns null + source='none' when DEFAULT_TENANT_ID is unset
 *     multi mode:
 *       - x-tenant-id header WINS over DEFAULT_TENANT_ID, source='header'
 *       - header absent → DEFAULT_TENANT_ID, source='default'
 *       - both absent → null, source='none'
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isMultiTenantMode, resolveTenantContext } from '../tenant-context-service';

const ORIG = { ...process.env };

beforeEach(() => {
  delete process.env.MULTI_TENANT_MODE;
  delete process.env.DEFAULT_TENANT_ID;
});

afterAll(() => {
  process.env = { ...ORIG };
});

function reqWithTenant(value?: string) {
  return {
    headers: {
      get: (name: string) =>
        name === 'x-tenant-id' && value !== undefined ? value : null,
    },
  };
}

// ============================================================
// isMultiTenantMode
// ============================================================

describe('isMultiTenantMode', () => {
  it('returns true for the canonical "multi"', () => {
    process.env.MULTI_TENANT_MODE = 'multi';
    expect(isMultiTenantMode()).toBe(true);
  });

  it('returns true for the legacy "true"', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    expect(isMultiTenantMode()).toBe(true);
  });

  it('returns false for "single"', () => {
    process.env.MULTI_TENANT_MODE = 'single';
    expect(isMultiTenantMode()).toBe(false);
  });

  it('returns false for any other value (typo guard)', () => {
    process.env.MULTI_TENANT_MODE = 'multi-tenant';
    expect(isMultiTenantMode()).toBe(false);
    process.env.MULTI_TENANT_MODE = 'MULTI';
    expect(isMultiTenantMode()).toBe(false); // case-sensitive
  });

  it('returns false when unset', () => {
    expect(isMultiTenantMode()).toBe(false);
  });
});

// ============================================================
// resolveTenantContext — single mode
// ============================================================

describe('resolveTenantContext — single mode', () => {
  it('returns DEFAULT_TENANT_ID with source=default', () => {
    process.env.DEFAULT_TENANT_ID = 'orion';
    const ctx = resolveTenantContext();
    expect(ctx).toEqual({ mode: 'single', tenantId: 'orion', source: 'default' });
  });

  it('returns null with source=none when DEFAULT_TENANT_ID is unset', () => {
    const ctx = resolveTenantContext();
    expect(ctx).toEqual({ mode: 'single', tenantId: null, source: 'none' });
  });

  it('IGNORES x-tenant-id header in single mode (cross-tenant attack guard)', () => {
    process.env.DEFAULT_TENANT_ID = 'orion';
    const ctx = resolveTenantContext(reqWithTenant('evil-tenant'));
    // Even if a malicious header is sent, single-tenant mode must NOT
    // honour it — otherwise an external request could pivot tenancy.
    expect(ctx.tenantId).toBe('orion');
    expect(ctx.source).toBe('default');
  });
});

// ============================================================
// resolveTenantContext — multi mode
// ============================================================

describe('resolveTenantContext — multi mode', () => {
  beforeEach(() => {
    process.env.MULTI_TENANT_MODE = 'multi';
  });

  it('reads x-tenant-id from the request, source=header', () => {
    process.env.DEFAULT_TENANT_ID = 'orion';
    const ctx = resolveTenantContext(reqWithTenant('partner-co'));
    expect(ctx).toEqual({ mode: 'multi', tenantId: 'partner-co', source: 'header' });
  });

  it('header WINS over DEFAULT_TENANT_ID (per-request override)', () => {
    process.env.DEFAULT_TENANT_ID = 'orion';
    const ctx = resolveTenantContext(reqWithTenant('partner-co'));
    expect(ctx.tenantId).toBe('partner-co');
  });

  it('falls back to DEFAULT_TENANT_ID when header is absent, source=default', () => {
    process.env.DEFAULT_TENANT_ID = 'orion';
    const ctx = resolveTenantContext(reqWithTenant(undefined));
    expect(ctx).toEqual({ mode: 'multi', tenantId: 'orion', source: 'default' });
  });

  it('returns null + source=none when both header and default are missing', () => {
    const ctx = resolveTenantContext(reqWithTenant(undefined));
    expect(ctx).toEqual({ mode: 'multi', tenantId: null, source: 'none' });
  });

  it('works without a request object (background jobs, workers)', () => {
    process.env.DEFAULT_TENANT_ID = 'orion';
    const ctx = resolveTenantContext();
    expect(ctx).toEqual({ mode: 'multi', tenantId: 'orion', source: 'default' });
  });
});
