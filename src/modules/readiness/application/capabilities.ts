export const READINESS_ABILITIES = [
  'readiness.read',
  'readiness.shift.manage',
  'readiness.handover.prepare',
  'readiness.handover.decide',
  'readiness.inspection.manage',
  'readiness.defect.manage',
  'readiness.meter.manage',
  'readiness.maintenance.manage',
  'readiness.permit.edit',
  'readiness.permit.approve_dispatcher',
  'readiness.permit.approve_admin',
  'readiness.rules.manage',
  'readiness.audit.read',
  'readiness.audit.export',
] as const;

export type ReadinessAbility = (typeof READINESS_ABILITIES)[number];
export type ReadinessRole = 'ADMIN' | 'DISPATCHER' | 'OPERATOR' | 'ASSISTANT' | 'MECHANIC';

const ROLE_ABILITIES: Record<ReadinessRole, readonly ReadinessAbility[]> = {
  ADMIN: [
    'readiness.read',
    'readiness.permit.approve_admin',
    'readiness.rules.manage',
    'readiness.audit.read',
    'readiness.audit.export',
  ],
  DISPATCHER: [
    'readiness.read',
    'readiness.handover.decide',
    'readiness.permit.approve_dispatcher',
    'readiness.audit.read',
  ],
  OPERATOR: [
    'readiness.read',
    'readiness.shift.manage',
    'readiness.handover.prepare',
  ],
  ASSISTANT: [],
  MECHANIC: [
    'readiness.read',
    'readiness.permit.edit',
    'readiness.inspection.manage',
    'readiness.defect.manage',
    'readiness.meter.manage',
    'readiness.maintenance.manage',
  ],
};

const READINESS_ROLES = new Set<ReadinessRole>([
  'ADMIN',
  'DISPATCHER',
  'OPERATOR',
  'ASSISTANT',
  'MECHANIC',
]);

export interface ReadinessActor {
  id: string;
  role: string;
}

export interface ReadinessActingAudit {
  actorId: string;
  actualRole: 'ADMIN';
  actingAs: 'MECHANIC';
}

export function isReadinessRole(role: string): role is ReadinessRole {
  return READINESS_ROLES.has(role as ReadinessRole);
}

export function resolveReadinessCapabilities(role: string): ReadonlySet<ReadinessAbility> {
  if (!isReadinessRole(role)) {
    return new Set();
  }
  return new Set(ROLE_ABILITIES[role]);
}

export async function resolveAuditedReadinessCapabilities(
  actor: ReadinessActor,
  actingAs: 'MECHANIC' | null,
  recordAudit: (entry: ReadinessActingAudit) => Promise<void>
): Promise<ReadonlySet<ReadinessAbility>> {
  const actual = resolveReadinessCapabilities(actor.role);
  if (actingAs === null) {
    return actual;
  }
  if (actor.role !== 'ADMIN') {
    return new Set();
  }

  await recordAudit({
    actorId: actor.id,
    actualRole: 'ADMIN',
    actingAs: 'MECHANIC',
  });

  return new Set([...actual, ...ROLE_ABILITIES.MECHANIC]);
}

export function hasReadinessCapability(
  capabilities: ReadonlySet<ReadinessAbility>,
  ability: ReadinessAbility
): boolean {
  return capabilities.has(ability);
}

export function serializeReadinessCapabilities(
  capabilities: ReadonlySet<ReadinessAbility>
): ReadinessAbility[] {
  return READINESS_ABILITIES.filter((ability) => capabilities.has(ability));
}
