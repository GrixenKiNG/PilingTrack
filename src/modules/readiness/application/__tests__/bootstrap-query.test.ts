import { describe, expect, it, vi } from 'vitest';
import { queryReadinessBootstrap, readReadinessFeatureFlags } from '../bootstrap-query';
import { TECH_READINESS_FLAGS, TECH_READINESS_USERS } from '../../../../../tests/fixtures/tech-readiness.fixture';

function transaction() {
  return {
    tenantSettings: {
      findUnique: vi.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
    equipment: {
      findMany: vi.fn().mockResolvedValue([{ id: 'eq-a', name: 'Rig A', model: 'M1' }]),
      count: vi.fn().mockResolvedValue(1),
    },
    site: {
      findMany: vi.fn().mockResolvedValue([{ id: 'site-a', name: 'Site A' }]),
      count: vi.fn().mockResolvedValue(1),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'mechanic-a', name: 'Mechanic A', role: 'MECHANIC' },
      ]),
    },
    crew: { count: vi.fn().mockResolvedValue(1) },
    readinessRuleSet: { count: vi.fn().mockResolvedValue(1) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
}

describe('readiness bootstrap query', () => {
  it('enables the approved readiness workflows by default and supports an explicit kill switch', () => {
    expect(readReadinessFeatureFlags({})).toEqual({
      readiness_shifts_v1: true,
      readiness_permits_v1: true,
      readiness_audit_chain_v1: true,
    });
    expect(readReadinessFeatureFlags({ READINESS_SHIFTS_V1: 'false' }).readiness_shifts_v1).toBe(false);
  });

  it('returns real tenant settings, flags, selectors, counts and mechanic capabilities', async () => {
    const tx = transaction();
    const result = await queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.mechanic,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS)
    );

    expect(result.tenant).toEqual({ timezone: 'Europe/Moscow' });
    expect(result.featureFlags).toEqual({
      readiness_shifts_v1: true,
      readiness_permits_v1: true,
      readiness_audit_chain_v1: false,
    });
    expect(result.selectors.equipment).toHaveLength(1);
    expect(result.counts).toMatchObject({ equipment: 1, sites: 1, activeCrews: 1 });
    expect(result.capabilities.entities.shift.manage).toBe(false);
    expect(result.capabilities.entities.shift.decideHandover).toBe(false);
    expect(result.capabilities.entities.maintenance.manage).toBe(true);
  });

  it('persists an ADMIN actingAs MECHANIC audit and returns the effective capabilities', async () => {
    const tx = transaction();
    const result = await queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.admin,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS),
      'MECHANIC',
      'request-1'
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'ReadinessActor',
        action: 'acting_as_mechanic',
        entityId: TECH_READINESS_USERS.admin.id,
        userRole: 'ADMIN',
        tenantId: TECH_READINESS_USERS.admin.tenantId,
        requestId: 'request-1',
        after: { actualRole: 'ADMIN', actingAs: 'MECHANIC' },
      }),
    });
    expect(result.actor.actingAs).toBe('MECHANIC');
    expect(result.capabilities.entities.maintenance.manage).toBe(true);
    expect(result.capabilities.entities.rules.manage).toBe(true);
  });

  it('rejects non-admin actingAs without writing an audit', async () => {
    const tx = transaction();
    await expect(queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.dispatcher,
      readReadinessFeatureFlags(TECH_READINESS_FLAGS),
      'MECHANIC'
    )).rejects.toMatchObject({ status: 403 });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('scopes every selector/count query to the session tenant and leaks no foreign identifier', async () => {
    const tx = transaction();
    const result = await queryReadinessBootstrap(
      tx as never,
      TECH_READINESS_USERS.admin,
      {
        readiness_shifts_v1: false,
        readiness_permits_v1: false,
        readiness_audit_chain_v1: false,
      }
    );
    const tenantId = TECH_READINESS_USERS.admin.tenantId;

    expect(tx.tenantSettings.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId } })
    );
    expect(tx.equipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }) })
    );
    expect(tx.site.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId }) })
    );
    expect(tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId, isActive: true }) })
    );
    expect(tx.crew.count).toHaveBeenCalledWith({
      where: { isActive: true, equipment: { tenantId } },
    });
    expect(JSON.stringify(result)).not.toContain('test-tenant-readiness-foreign');
    expect(result.tenant).not.toHaveProperty('id');
  });

  it('fails closed when tenant settings are missing or the role is unsupported', async () => {
    const missingSettings = transaction();
    missingSettings.tenantSettings.findUnique.mockResolvedValue(null);
    await expect(queryReadinessBootstrap(
      missingSettings as never,
      TECH_READINESS_USERS.admin
    )).rejects.toMatchObject({ status: 503 });

    await expect(queryReadinessBootstrap(
      transaction() as never,
      { ...TECH_READINESS_USERS.admin, role: 'OWNER' }
    )).rejects.toMatchObject({ status: 403 });
  });

  it('uses the organization default when a legacy timezone value is invalid', async () => {
    const tx = transaction();
    tx.tenantSettings.findUnique.mockResolvedValue({ timezone: '(UTC+3) Moscow' });

    const result = await queryReadinessBootstrap(tx as never, TECH_READINESS_USERS.admin);

    expect(result.tenant.timezone).toBe('Europe/Moscow');
  });
});
