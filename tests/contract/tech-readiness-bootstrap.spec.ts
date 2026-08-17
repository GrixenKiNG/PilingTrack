import { describe, expect, it } from 'vitest';
import { ensureTenantAccess } from '../../src/services/auth/resource-access-service';
import { resolveReadinessCapabilities } from '../../src/modules/readiness/application/capabilities';

describe('Tech Readiness Task 01 contract slice [TR-200, TR-201, TR-204]', () => {
  it('returns the same safe 404 for missing and cross-tenant resources', async () => {
    const actor = { id: 'test-admin', role: 'ADMIN', tenantId: 'test-tenant-a' };

    const crossTenant = ensureTenantAccess(actor, 'test-tenant-b', 'resource');
    const missing = ensureTenantAccess(actor, null, 'resource');

    await expect(crossTenant).rejects.toMatchObject({
      status: 404,
      message: 'resource not found',
    });
    await expect(missing).rejects.toMatchObject({
      status: 404,
      message: 'resource not found',
    });
  });

  // Администратор с 16.08.2026 получает все полномочия модуля по умолчанию
  // (`ADMIN: READINESS_ABILITIES` в domain/capability-defaults.ts), поэтому
  // `readiness.shift.manage` у него теперь есть. Ограничивает его не отсутствие
  // права, а режим «Действую как» и журнал замещения.
  //
  // Требование «повышенный риск подписывают двое» это НЕ ослабляет: оно
  // проверяет человека, а не роль — `approval-policy.ts` сверяет `approvedById`
  // и требует `users.size >= roles.length`. Администратор с обоими правами всё
  // равно не закроет наряд на две подписи в одиночку.
  it.each([
    ['ADMIN', true, true],
    ['MECHANIC', false, false],
    ['DISPATCHER', false, false],
    ['OPERATOR', true, false],
  ] as const)(
    'pins mechanic/admin readiness capability boundaries for %s',
    (role, canManageShift, canApproveAsAdmin) => {
      const capabilities = resolveReadinessCapabilities(role);
      expect(capabilities.has('readiness.shift.manage')).toBe(canManageShift);
      expect(capabilities.has('readiness.permit.approve_admin')).toBe(canApproveAsAdmin);
    }
  );

  it('does not derive tenant or acting role from spoofable values', () => {
    const actorCapabilities = resolveReadinessCapabilities('DISPATCHER');
    const spoofedRole = 'ADMIN';

    expect(actorCapabilities.has('readiness.permit.approve_admin')).toBe(false);
    expect(resolveReadinessCapabilities(spoofedRole).has('readiness.permit.approve_admin')).toBe(true);
    // The capability layer receives only the verified actor role; request fields
    // are intentionally absent from its contract.
  });
});
