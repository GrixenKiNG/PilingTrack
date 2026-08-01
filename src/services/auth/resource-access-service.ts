import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import {
  assertCan,
  can,
  resolveUserScope,
  type Ability,
  type SessionActor,
} from '@/services/auth/authorization-service';

export function resolveAccessibleUserId(
  sessionUser: SessionActor,
  requestedUserId?: string | null,
  ability: Ability = 'reports.read_cross_user'
) {
  return resolveUserScope(sessionUser, requestedUserId, ability);
}

export async function assertUserAssignedToSite(userId: string, siteId: string) {
  const assignment = await db.userSiteAssignment.findUnique({
    where: { userId_siteId: { userId, siteId } },
    select: { id: true },
  });

  if (!assignment) {
    throw new ServiceError('Нет доступа к этому объекту', 403);
  }
}

export async function assertCanAccessSite(
  sessionUser: SessionActor,
  siteId: string,
  privilegedAbility: Ability = 'sites.read_all'
) {
  if (can(sessionUser, privilegedAbility)) {
    return;
  }

  await assertUserAssignedToSite(sessionUser.id, siteId);
}

export function assertCanAccessReportOwner(
  sessionUser: SessionActor,
  reportOwnerId: string,
  privilegedAbility: Ability = 'reports.read_cross_user'
) {
  const resolvedOwnerId = resolveUserScope(sessionUser, reportOwnerId, privilegedAbility);
  if (resolvedOwnerId !== reportOwnerId) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

export function assertCanManageUserScope(
  sessionUser: SessionActor,
  targetUserId: string,
  privilegedAbility: Ability = 'reports.manage_all'
) {
  if (targetUserId === sessionUser.id) {
    return;
  }

  assertCan(sessionUser, privilegedAbility);
}

/**
 * Проверяет session-owned tenant для любой роли и режима развертывания.
 * Отсутствующий tenant у сессии дает 403, а отсутствующий/чужой ресурс —
 * одинаковый безопасный 404 без раскрытия существования идентификатора.
 */
export async function ensureTenantAccess(
  user: { id: string; role: string; tenantId?: string | null },
  resourceTenantId: string | null | undefined,
  resourceName: string
): Promise<void> {
  // Tenant isolation is session-owned for every role and deployment mode.
  if (!user.tenantId) {
    throw new ServiceError('Tenant context missing', 403);
  }

  if (resourceTenantId !== user.tenantId) {
    throw new ServiceError(`${resourceName} not found`, 404);
  }
}
