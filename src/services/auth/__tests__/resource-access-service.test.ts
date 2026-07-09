import { afterEach, describe, expect, it } from 'vitest';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';

describe('ensureTenantAccess', () => {
  const ORIGINAL = process.env.MULTI_TENANT_MODE;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.MULTI_TENANT_MODE;
    else process.env.MULTI_TENANT_MODE = ORIGINAL;
  });

  describe('single-tenant deployment (MULTI_TENANT_MODE !== "true")', () => {
    it('allows OPERATOR with null tenantId to access null-tenant resources', async () => {
      delete process.env.MULTI_TENANT_MODE;
      await expect(
        ensureTenantAccess({ id: 'u1', role: 'OPERATOR', tenantId: null }, null, 'report')
      ).resolves.toBeUndefined();
    });

    it('allows ASSISTANT with null tenantId', async () => {
      process.env.MULTI_TENANT_MODE = 'single';
      await expect(
        ensureTenantAccess({ id: 'u1', role: 'ASSISTANT', tenantId: null }, null, 'report')
      ).resolves.toBeUndefined();
    });

    it('does not enforce when MULTI_TENANT_MODE is unset', async () => {
      delete process.env.MULTI_TENANT_MODE;
      // Even mismatched tenants pass — single-tenant has no boundary to enforce.
      await expect(
        ensureTenantAccess(
          { id: 'u1', role: 'OPERATOR', tenantId: 't-a' },
          't-b',
          'report'
        )
      ).resolves.toBeUndefined();
    });
  });

  describe('multi-tenant deployment (MULTI_TENANT_MODE === "true")', () => {
    it('rejects OPERATOR with no tenantId', async () => {
      process.env.MULTI_TENANT_MODE = 'true';
      await expect(
        ensureTenantAccess({ id: 'u1', role: 'OPERATOR', tenantId: null }, 't-a', 'report')
      ).rejects.toThrow(/no tenant assignment/);
    });

    it('rejects OPERATOR when resource belongs to a different tenant', async () => {
      process.env.MULTI_TENANT_MODE = 'true';
      await expect(
        ensureTenantAccess(
          { id: 'u1', role: 'OPERATOR', tenantId: 't-a' },
          't-b',
          'report'
        )
      ).rejects.toThrow(/different tenant/);
    });

    it('allows OPERATOR when tenants match', async () => {
      process.env.MULTI_TENANT_MODE = 'true';
      await expect(
        ensureTenantAccess(
          { id: 'u1', role: 'OPERATOR', tenantId: 't-a' },
          't-a',
          'report'
        )
      ).resolves.toBeUndefined();
    });

    it('enforces under the canonical mode value "multi" too', async () => {
      // Regression (2026-07-02 audit H7): this check compared the env var to
      // the literal 'true' while the canonical value elsewhere is 'multi' —
      // enabling multi-tenant the documented way silently skipped enforcement.
      process.env.MULTI_TENANT_MODE = 'multi';
      await expect(
        ensureTenantAccess(
          { id: 'u1', role: 'OPERATOR', tenantId: 't-a' },
          't-b',
          'report'
        )
      ).rejects.toThrow(/different tenant/);
    });
  });

  describe('privileged roles', () => {
    it('ADMIN bypasses checks even with mismatched tenants', async () => {
      process.env.MULTI_TENANT_MODE = 'true';
      await expect(
        ensureTenantAccess(
          { id: 'u1', role: 'ADMIN', tenantId: 't-a' },
          't-b',
          'report'
        )
      ).resolves.toBeUndefined();
    });

    it('DISPATCHER bypasses checks', async () => {
      process.env.MULTI_TENANT_MODE = 'true';
      await expect(
        ensureTenantAccess(
          { id: 'u1', role: 'DISPATCHER', tenantId: null },
          't-b',
          'report'
        )
      ).resolves.toBeUndefined();
    });
  });
});
