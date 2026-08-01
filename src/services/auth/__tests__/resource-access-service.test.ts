import { describe, expect, it } from 'vitest';
import { ensureTenantAccess } from '@/services/auth/resource-access-service';

describe('ensureTenantAccess', () => {
  it('fails closed when the authenticated session has no tenant', async () => {
    await expect(
      ensureTenantAccess({ id: 'u1', role: 'OPERATOR', tenantId: null }, 't-a', 'report')
    ).rejects.toMatchObject({ status: 403, message: 'Tenant context missing' });
  });

  it.each(['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC'])(
    'returns the same safe 404 for a cross-tenant resource for %s',
    async (role) => {
      await expect(
        ensureTenantAccess({ id: 'u1', role, tenantId: 't-a' }, 't-b', 'report')
      ).rejects.toMatchObject({ status: 404, message: 'report not found' });
    }
  );

  it('returns the same safe 404 for missing and cross-tenant ownership', async () => {
    const actor = { id: 'u1', role: 'ADMIN', tenantId: 't-a' };

    await expect(
      ensureTenantAccess(actor, 't-b', 'report')
    ).rejects.toMatchObject({ status: 404, message: 'report not found' });
    await expect(
      ensureTenantAccess(actor, null, 'report')
    ).rejects.toMatchObject({ status: 404, message: 'report not found' });
  });

  it('allows access only when the resource tenant matches the session tenant', async () => {
    await expect(
      ensureTenantAccess(
        { id: 'u1', role: 'MECHANIC', tenantId: 't-a' },
        't-a',
        'equipment'
      )
    ).resolves.toBeUndefined();
  });
});
