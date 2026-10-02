/**
 * Integration tests for withTenantContext — the transaction that sets
 * PostgreSQL app.current_tenant for strict RLS.
 *
 * Тесты requireTenant()/tenantWhere() удалены вместе с самими помощниками
 * 01.10.2026: приложение их не вызывало, а без организации они пропускали
 * запрос (аудит Codex out55, F03).
 *
 * These tests do not boot a real database. They mock the Prisma transaction
 * surface.
 */

import { describe, it, expect, vi } from 'vitest';

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
