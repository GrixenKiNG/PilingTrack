import { ServiceError } from '@/services/service-error';

export type Role = 'ADMIN' | 'DISPATCHER' | 'OPERATOR' | 'ASSISTANT';

export type Ability =
  | 'analytics.read'
  | 'reports.read_all'
  | 'reports.read_cross_user'
  | 'reports.export'
  | 'reports.manage_all'
  | 'sites.read_all'
  | 'sites.manage'
  | 'sites.assign_users'
  | 'sites.manage_hierarchy'
  | 'users.manage'
  | 'equipment.manage'
  | 'crews.read'
  | 'crews.manage'
  | 'crews.legacy_manage'
  | 'dictionary.manage'
  | 'telegram.manage'
  | 'system.read'
  | 'media.upload'
  | 'dlq.manage'
  | 'projections.rebuild';

export interface SessionActor {
  id: string;
  role: string;
}

const abilityRoles: Record<Ability, Role[]> = {
  'analytics.read': ['ADMIN', 'DISPATCHER'],
  'reports.read_all': ['ADMIN', 'DISPATCHER'],
  'reports.read_cross_user': ['ADMIN', 'DISPATCHER'],
  'reports.export': ['ADMIN'],
  'reports.manage_all': ['ADMIN', 'DISPATCHER'],
  'sites.read_all': ['ADMIN', 'DISPATCHER'],
  'sites.manage': ['ADMIN', 'DISPATCHER'],
  'sites.assign_users': ['ADMIN', 'DISPATCHER'],
  'sites.manage_hierarchy': ['ADMIN', 'DISPATCHER'],
  'users.manage': ['ADMIN'],
  'equipment.manage': ['ADMIN'],
  'crews.read': ['ADMIN', 'DISPATCHER'],
  'crews.manage': ['ADMIN', 'DISPATCHER'],
  'crews.legacy_manage': ['ADMIN'],
  'dictionary.manage': ['ADMIN'],
  'telegram.manage': ['ADMIN'],
  'system.read': ['ADMIN', 'DISPATCHER'],
  'media.upload': ['ADMIN', 'DISPATCHER', 'OPERATOR'],
  'dlq.manage': ['ADMIN'],
  'projections.rebuild': ['ADMIN'],
};

export function isPrivilegedRole(role: string) {
  return role === 'ADMIN' || role === 'DISPATCHER';
}

export function can(user: { role: string }, ability: Ability) {
  return abilityRoles[ability].includes(user.role as Role);
}

export function assertCan(user: { role: string }, ability: Ability) {
  if (!can(user, ability)) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

export function assertRole(user: { role: string }, role: Role) {
  if (user.role !== role) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

export function assertAnyRole(user: { role: string }, roles: Role[]) {
  if (!roles.includes(user.role as Role)) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

export function assertNotSelfAction(actorId: string, targetId: string, message: string) {
  if (actorId === targetId) {
    throw new ServiceError(message, 400);
  }
}

export function resolveUserScope(
  sessionUser: SessionActor,
  requestedUserId?: string | null,
  ability: Ability = 'reports.read_cross_user'
) {
  if (requestedUserId && requestedUserId !== sessionUser.id) {
    assertCan(sessionUser, ability);
    return requestedUserId;
  }

  return requestedUserId || sessionUser.id;
}
