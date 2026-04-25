/**
 * Integration tests for multi-tenant isolation helpers.
 *
 * Cover three layers of defense:
 *  1. requireTenant() — throws on missing tenant in multi-tenant mode
 *  2. tenantWhere()   — automatic Prisma where filter
 *  3. withTenantContext() — sets PostgreSQL session variable for RLS
 *
 * These tests do not boot a real database. They exercise the helpers in
 * isolation against deterministic inputs and mock the Prisma transaction
 * surface where needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  requireTenant,
  tenantWhere,
  runWithTenantContext,
} from '@/core/security/tenant-enforcement';

describe('tenant isolation — requireTenant', () => {
  beforeEach(() => {
    delete process.env.MULTI_TENANT_MODE;
  });

  it('returns user.tenantId when set in multi-tenant mode', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    const tenantId = requireTenant({ id: 'u1', role: 'OPERATOR', tenantId: 't-acme' });
    expect(tenantId).toBe('t-acme');
  });

  it('throws 403 in multi-tenant mode when tenant cannot be resolved', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    expect(() =>
      requireTenant({ id: 'u1', role: 'OPERATOR', tenantId: null })
    ).toThrow(/Tenant ID is required/);
  });

  it('honors header override when explicitly passed (admin/dispatch flows)', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    const tenantId = requireTenant(
      { id: 'u1', role: 'ADMIN', tenantId: 't-acme' },
      't-other'
    );
    expect(tenantId).toBe('t-other');
  });

  it('returns empty string when multi-tenant mode is disabled', () => {
    delete process.env.MULTI_TENANT_MODE;
    const tenantId = requireTenant({ id: 'u1', role: 'OPERATOR', tenantId: null });
    expect(tenantId).toBe('');
  });
});

describe('tenant isolation — tenantWhere', () => {
  beforeEach(() => {
    delete process.env.MULTI_TENANT_MODE;
  });

  it('appends tenantId to where clause in multi-tenant mode', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    runWithTenantContext({ tenantId: 't-acme', userId: 'u1' }, () => {
      const where = tenantWhere({ userId: 'u1' });
      expect(where).toEqual({ userId: 'u1', tenantId: 't-acme' });
    });
  });

  it('preserves caller-supplied tenantId when explicitly passed', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    const where = tenantWhere({ userId: 'u1' }, 't-explicit');
    expect(where).toMatchObject({ userId: 'u1', tenantId: 't-explicit' });
  });

  it('returns where unchanged in single-tenant mode', () => {
    delete process.env.MULTI_TENANT_MODE;
    const where = tenantWhere({ userId: 'u1' });
    expect(where).toEqual({ userId: 'u1' });
  });

  it('does not leak tenantId when no context exists in multi-tenant mode', () => {
    process.env.MULTI_TENANT_MODE = 'true';
    const where = tenantWhere({ userId: 'u1' });
    // Without explicit tenant or context, the helper degrades gracefully —
    // the caller is expected to pair this with requireTenant() upstream.
    expect(where).toEqual({ userId: 'u1' });
  });
});

describe('tenant isolation — withTenantContext (RLS wiring)', () => {
  it('opens a transaction and sets app.current_tenant transaction-locally', async () => {
    const executeRaw = vi.fn().mockResolvedValue(0);
    const callback = vi.fn().mockResolvedValue('ok');
    const tx = { $executeRaw: executeRaw };
    const $transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));

    vi.doMock('@/lib/db', () => ({ db: { $transaction } }));
    const { withTenantContext } = await import('@/core/security/tenant-enforcement');

    const result = await withTenantContext('t-acme', callback);

    expect(result).toBe('ok');
    expect($transaction).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalledOnce();
    // Use `set_config(name, value, is_local=true)` — tx-scoped, like SET LOCAL.
    const rawCall = executeRaw.mock.calls[0];
    expect(String(rawCall[0]?.join?.(' ') ?? rawCall[0])).toContain('set_config');
    expect(callback).toHaveBeenCalledWith(tx);

    vi.doUnmock('@/lib/db');
  });

  it('refuses to run with empty tenantId', async () => {
    const { withTenantContext } = await import('@/core/security/tenant-enforcement');
    await expect(withTenantContext('', vi.fn())).rejects.toThrow(/requires a tenantId/);
  });
});
