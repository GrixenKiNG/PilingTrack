/**
 * Tenant enforcement middleware — behavioural tests.
 *
 * Security-critical: these helpers are the tenant-isolation boundary. The
 * fail-closed path of `requireTenant` and the scoping of `tenantWhere` are the
 * direct guards against the cross-tenant IDOR class documented in CLAUDE.md.
 *
 * Mode is driven by the real MULTI_TENANT_MODE / DEFAULT_TENANT_ID env vars
 * (what `isMultiTenantMode`/`resolveTenantContext` actually read) rather than
 * mocks, so the tests exercise the genuine integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  tenantContextStorage,
  getCurrentTenantId,
  withTenantContext,
  requireTenant,
  tenantWhere,
} from '../tenant-enforcement-middleware';

const ENV_KEYS = ['MULTI_TENANT_MODE', 'DEFAULT_TENANT_ID'] as const;

describe('tenant-enforcement-middleware', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setMode(mode: 'multi' | 'single') {
    if (mode === 'multi') process.env.MULTI_TENANT_MODE = 'multi';
    else delete process.env.MULTI_TENANT_MODE;
  }

  describe('getCurrentTenantId', () => {
    it('returns null outside any tenant context', () => {
      expect(getCurrentTenantId()).toBeNull();
    });

    it('returns the value stored in the surrounding async context', () => {
      tenantContextStorage.run('orion', () => {
        expect(getCurrentTenantId()).toBe('orion');
      });
    });
  });

  describe('withTenantContext', () => {
    it('runs the handler inside the resolved tenant context', async () => {
      setMode('single');
      process.env.DEFAULT_TENANT_ID = 'orion';

      const seen = await withTenantContext(new Request('http://localhost'), async (tenantId) => {
        // Handler receives the tenant and can also read it from ALS.
        expect(getCurrentTenantId()).toBe(tenantId);
        return tenantId;
      });

      expect(seen).toBe('orion');
    });

    it('propagates the handler return value', async () => {
      setMode('single');
      process.env.DEFAULT_TENANT_ID = 'orion';

      const result = await withTenantContext(new Request('http://localhost'), async () => 42);
      expect(result).toBe(42);
    });
  });

  describe('requireTenant (fail-closed boundary)', () => {
    it('throws in multi-tenant mode when no tenant is in context', () => {
      setMode('multi');
      expect(() => requireTenant()).toThrow(/Tenant ID is required/);
    });

    it('returns the tenant in multi-tenant mode when one is set', () => {
      setMode('multi');
      tenantContextStorage.run('tenant-a', () => {
        expect(requireTenant()).toBe('tenant-a');
      });
    });

    it('returns empty string in single-tenant mode without throwing', () => {
      setMode('single');
      expect(requireTenant()).toBe('');
    });
  });

  describe('tenantWhere', () => {
    it('injects tenantId into the where clause in multi-tenant mode', () => {
      setMode('multi');
      tenantContextStorage.run('tenant-a', () => {
        expect(tenantWhere({ status: 'active' })).toEqual({
          status: 'active',
          tenantId: 'tenant-a',
        });
      });
    });

    it('leaves the where clause untouched in single-tenant mode', () => {
      setMode('single');
      const where = { status: 'active' };
      expect(tenantWhere(where)).toEqual({ status: 'active' });
    });

    it('fails closed: throws in multi-tenant mode with no tenant rather than returning an unscoped query', () => {
      setMode('multi');
      expect(() => tenantWhere({ status: 'active' })).toThrow(/Tenant ID is required/);
    });
  });
});
