import { ServiceError } from '@/lib/service-error';
import type { ReadinessTransaction } from '../infrastructure/tenant-transaction';
import { normalizeTenantTimezone } from '../domain/shifts/tenant-production-date';
import {
  hasReadinessCapability,
  resolveAuditedReadinessCapabilities,
  serializeReadinessCapabilities,
} from './capabilities';

export interface ReadinessBootstrapActor {
  id: string;
  name: string;
  role: string;
  tenantId: string;
}

export interface ReadinessFeatureFlags {
  readiness_shifts_v1: boolean;
  readiness_permits_v1: boolean;
  readiness_audit_chain_v1: boolean;
}

function enabled(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

export function readReadinessFeatureFlags(
  environment: Record<string, string | undefined> = process.env
): ReadinessFeatureFlags {
  return {
    readiness_shifts_v1: environment.READINESS_SHIFTS_V1 === undefined
      ? true
      : enabled(environment.READINESS_SHIFTS_V1),
    readiness_permits_v1: environment.READINESS_PERMITS_V1 === undefined
      ? true
      : enabled(environment.READINESS_PERMITS_V1),
    readiness_audit_chain_v1: environment.READINESS_AUDIT_CHAIN_V1 === undefined
      ? true
      : enabled(environment.READINESS_AUDIT_CHAIN_V1),
  };
}

function assertIanaTimezone(timezone: string): string {
  return normalizeTenantTimezone(timezone);
}

export async function queryReadinessBootstrap(
  tx: ReadinessTransaction,
  actor: ReadinessBootstrapActor,
  flags = readReadinessFeatureFlags(),
  actingAs: 'MECHANIC' | null = null,
  requestId: string | null = null,
) {
  const capabilities = await resolveAuditedReadinessCapabilities(
    actor,
    actingAs,
    async (entry) => {
      await tx.auditLog.create({
        data: {
          entity: 'ReadinessActor',
          action: 'acting_as_mechanic',
          entityId: actor.id,
          after: {
            actualRole: entry.actualRole,
            actingAs: entry.actingAs,
          },
          userId: actor.id,
          userName: actor.name,
          userRole: entry.actualRole,
          tenantId: actor.tenantId,
          requestId,
        },
      });
    }
  );
  if (!capabilities.has('readiness.read')) {
    throw new ServiceError('Readiness access denied', 403);
  }

  const [
    settings,
    equipment,
    sites,
    actors,
    equipmentCount,
    siteCount,
    crewCount,
    publishedRuleSetCount,
    draftRuleSetCount,
  ] = await Promise.all([
    tx.tenantSettings.findUnique({
      where: { tenantId: actor.tenantId },
      select: { timezone: true },
    }),
    tx.equipment.findMany({
      where: { tenantId: actor.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, model: true },
    }),
    tx.site.findMany({
      where: { tenantId: actor.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    tx.user.findMany({
      where: {
        tenantId: actor.tenantId,
        isActive: true,
        role: { in: ['ADMIN', 'DISPATCHER', 'MECHANIC'] },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    }),
    tx.equipment.count({ where: { tenantId: actor.tenantId, isActive: true } }),
    tx.site.count({ where: { tenantId: actor.tenantId, isActive: true } }),
    tx.crew.count({
      where: { isActive: true, equipment: { tenantId: actor.tenantId } },
    }),
    tx.readinessRuleSet.count({
      where: { tenantId: actor.tenantId, status: 'PUBLISHED' },
    }),
    tx.readinessRuleSet.count({
      where: { tenantId: actor.tenantId, status: 'DRAFT' },
    }),
  ]);

  if (!settings) {
    throw new ServiceError('Tenant settings are not configured', 503);
  }

  const can = (ability: Parameters<typeof hasReadinessCapability>[1]) =>
    hasReadinessCapability(capabilities, ability);

  return {
    tenant: {
      timezone: assertIanaTimezone(settings.timezone),
    },
    actor: {
      id: actor.id,
      role: actor.role,
      actingAs,
    },
    featureFlags: flags,
    selectors: {
      equipment,
      sites,
      actors,
    },
    counts: {
      equipment: equipmentCount,
      sites: siteCount,
      activeCrews: crewCount,
      publishedRuleSets: publishedRuleSetCount,
      draftRuleSets: draftRuleSetCount,
    },
    capabilities: {
      abilities: serializeReadinessCapabilities(capabilities),
      screens: {
        readiness: can('readiness.read'),
        fleet: can('readiness.read'),
        shifts: flags.readiness_shifts_v1 && can('readiness.read'),
        permits: flags.readiness_permits_v1 && can('readiness.read'),
        maintenance: can('readiness.read'),
        reports: can('readiness.audit.read'),
        settings: can('readiness.rules.manage') || can('readiness.audit.read'),
      },
      entities: {
        equipment: {
          read: can('readiness.read'),
        },
        inspection: {
          manage: can('readiness.inspection.manage'),
        },
        defect: {
          manage: can('readiness.defect.manage'),
        },
        meter: {
          manage: can('readiness.meter.manage'),
        },
        maintenance: {
          manage: can('readiness.maintenance.manage'),
        },
        shift: {
          manage: can('readiness.shift.manage'),
          prepareHandover: can('readiness.handover.prepare'),
          decideHandover: can('readiness.handover.decide'),
        },
        permit: {
          edit: can('readiness.permit.edit'),
          approveDispatcher: can('readiness.permit.approve_dispatcher'),
          approveAdmin: can('readiness.permit.approve_admin'),
        },
        rules: {
          manage: can('readiness.rules.manage'),
        },
        audit: {
          read: can('readiness.audit.read'),
          export: can('readiness.audit.export'),
        },
      },
      canActAsMechanic: actor.role === 'ADMIN',
    },
  };
}
