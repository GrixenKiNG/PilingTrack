import { describe, it, expect } from 'vitest';
import { assertCanAccessMedia, assertCanAccessMediaEntity } from '../media-auth';

describe('assertCanAccessMediaEntity — equipment', () => {
  it('allows ADMIN to manage equipment media and rejects DISPATCHER', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    await expect(assertCanAccessMediaEntity({ id: 'u', role: 'ADMIN' } as any, 'equipment', 'eq1')).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    await expect(assertCanAccessMediaEntity({ id: 'u', role: 'DISPATCHER' } as any, 'equipment', 'eq1')).rejects.toThrow();
  });

  it('rejects OPERATOR for equipment media', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
      assertCanAccessMediaEntity({ id: 'u', role: 'OPERATOR' } as any, 'equipment', 'eq1'),
    ).rejects.toThrow();
  });
});

describe('assertCanAccessMedia — equipment photos (existing records)', () => {
  const equipmentMedia = { userId: 'admin-1', entityType: 'equipment', entityId: 'eq1', tenantId: 'orion' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
  const operator = { id: 'op-1', role: 'OPERATOR', tenantId: 'orion' } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
  const admin = { id: 'admin-1', role: 'ADMIN', tenantId: 'orion' } as any;

  it('allows any same-tenant user to READ an equipment photo (fleet dashboard is for all roles)', () => {
    expect(() => assertCanAccessMedia(operator, equipmentMedia, 'read')).not.toThrow();
  });

  it('rejects cross-tenant and missing-tenant reads of equipment photos (fail closed)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'x', role: 'OPERATOR', tenantId: 'other' } as any, equipmentMedia, 'read')).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'x', role: 'OPERATOR' } as any, equipmentMedia, 'read')).toThrow();
    expect(() => assertCanAccessMedia(operator, { ...equipmentMedia, tenantId: null }, 'read')).toThrow();
  });

  it('only ADMIN may mutate (confirm/delete) an equipment photo — DISPATCHER and OPERATOR rejected', () => {
    expect(() => assertCanAccessMedia(admin, equipmentMedia)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'd', role: 'DISPATCHER', tenantId: 'orion' } as any, equipmentMedia)).toThrow();
    expect(() => assertCanAccessMedia(operator, equipmentMedia)).toThrow();
  });

  it('keeps legacy behavior for non-equipment media: owner or privileged role', () => {
    const reportMedia = { userId: 'op-1', entityType: 'report', entityId: 'r1', tenantId: 'orion' };
    expect(() => assertCanAccessMedia(operator, reportMedia)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test actor stub
    expect(() => assertCanAccessMedia({ id: 'other-op', role: 'OPERATOR', tenantId: 'orion' } as any, reportMedia)).toThrow();
  });
});
