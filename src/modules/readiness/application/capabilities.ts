import type { ActingRole } from '@/lib/types';

export const READINESS_ABILITIES = [
  'readiness.read',
  'readiness.shift.manage',
  'readiness.handover.prepare',
  'readiness.handover.decide',
  'readiness.inspection.manage',
  // Зафиксировать замечание может любой, кто работает со сменой; разбирать,
  // закрывать и отклонять — только диспетчер, механик и администратор.
  'readiness.defect.report',
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
export type ReadinessRole =
  | 'ADMIN' | 'DISPATCHER' | 'OPERATOR' | 'ASSISTANT'
  | 'MECHANIC' | 'FOREMAN' | 'SAFETY_ENGINEER';

const ROLE_ABILITIES: Record<ReadinessRole, readonly ReadinessAbility[]> = {
  ADMIN: [
    'readiness.read',
    // В ОРИОНе обязанности механика исполняет администратор, поэтому разбор
    // дефектов у него прямой, а не только через режим «действую за механика».
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.permit.approve_admin',
    'readiness.rules.manage',
    'readiness.audit.read',
    'readiness.audit.export',
  ],
  DISPATCHER: [
    'readiness.read',
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.handover.decide',
    'readiness.permit.approve_dispatcher',
    'readiness.audit.read',
  ],
  OPERATOR: [
    'readiness.read',
    'readiness.shift.manage',
    'readiness.handover.prepare',
    'readiness.defect.report',
  ],
  ASSISTANT: ['readiness.defect.report'],
  MECHANIC: [
    'readiness.read',
    'readiness.permit.edit',
    'readiness.inspection.manage',
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.meter.manage',
    'readiness.maintenance.manage',
  ],
  // Мастер отвечает за ход работ на участке: видит контур и фиксирует
  // замечания, но не закрывает дефекты и не решает по допуску — это
  // диспетчер и механик.
  FOREMAN: [
    'readiness.read',
    'readiness.defect.report',
    'readiness.audit.read',
  ],
  // Инженер ОТ — охрана труда: осмотры и наряды-допуски, разбор замечаний
  // по безопасности. Смену не запускает и не принимает.
  SAFETY_ENGINEER: [
    'readiness.read',
    'readiness.permit.edit',
    'readiness.inspection.manage',
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.audit.read',
  ],
};

const READINESS_ROLES = new Set<ReadinessRole>([
  'ADMIN',
  'DISPATCHER',
  'OPERATOR',
  'ASSISTANT',
  'MECHANIC',
  'FOREMAN',
  'SAFETY_ENGINEER',
]);

export interface ReadinessActor {
  id: string;
  role: string;
}

export interface ReadinessActingAudit {
  actorId: string;
  actualRole: 'ADMIN';
  actingAs: ActingRole;
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
  actingAs: ActingRole | null,
  recordAudit: (entry: ReadinessActingAudit) => Promise<void>
): Promise<ReadonlySet<ReadinessAbility>> {
  const actual = resolveReadinessCapabilities(actor.role);
  if (actingAs === null) {
    return actual;
  }
  if (actor.role !== 'ADMIN') {
    return new Set();
  }

  // В журнал уходит именно та роль, которую администратор исполняет, а не
  // всегда «механик»: иначе действия мастера и инженера ОТ были бы неотличимы
  // от механических, и доказательный журнал врал бы.
  await recordAudit({
    actorId: actor.id,
    actualRole: 'ADMIN',
    actingAs,
  });

  return new Set([...actual, ...ROLE_ABILITIES[actingAs]]);
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
