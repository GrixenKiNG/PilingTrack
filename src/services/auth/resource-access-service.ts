import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { isMultiTenantMode } from '@/services/tenancy/tenant-context-service';
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
 * Проверяет, что пользователь имеет доступ к ресурсу указанного tenant.
 * ADMIN/DISPATCHER имеют доступ ко всем tenant.
 * OPERATOR/ASSISTANT — только к своему tenant.
 *
 * Single-tenant установки (MULTI_TENANT_MODE != 'true') пропускают проверку:
 * у юзеров и ресурсов tenantId == null, и enforcement смысла не имеет.
 * Multi-tenant установки fail-closed на отсутствии tenantId у юзера.
 */
export async function ensureTenantAccess(
  user: { id: string; role: string; tenantId?: string | null },
  resourceTenantId: string | null | undefined,
  resourceName: string
): Promise<void> {
  // ADMIN/DISPATCHER bypass tenant checks
  if (user.role === 'ADMIN' || user.role === 'DISPATCHER') return;

  // Single-tenant deployment — no isolation to enforce. Mode parsing is
  // centralized in isMultiTenantMode(): comparing to the literal 'true' here
  // silently skipped enforcement under the canonical value 'multi' (audit H7).
  if (!isMultiTenantMode()) return;

  // Multi-tenant deployment from here on.
  // Fail-closed: an OPERATOR/ASSISTANT without a tenant assignment must NOT
  // be able to access tenant-owned resources.
  if (!user.tenantId) {
    throw new ServiceError(`Access denied: user has no tenant assignment`, 403);
  }

  // For OPERATOR/ASSISTANT: must have same tenantId as the resource.
  if (resourceTenantId !== user.tenantId) {
    throw new ServiceError(`Access denied: ${resourceName} belongs to different tenant`, 403);
  }
}
