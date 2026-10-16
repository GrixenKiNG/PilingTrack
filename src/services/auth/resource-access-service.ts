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

/**
 * Владелец отчёта работает на объекте: по прямому назначению ИЛИ по действующей
 * бригаде этого объекта.
 *
 * ПОЧЕМУ НЕ ТОЛЬКО НАЗНАЧЕНИЕ. Мобильный отчёт создаётся по бригаде
 * (`Crew.siteId`), и у такого машиниста прямого `UserSiteAssignment` может не
 * быть. Команда правки отчёта требовала именно его, и администратор получал 403
 * «Нет доступа к этому объекту» на штатный отчёт (аудит 16.10.2026, P1 AU39-04).
 * Выдавать новое назначение в обход решения владельца нельзя — основанием служит
 * сама бригада.
 *
 * ПОЧЕМУ ОРГАНИЗАЦИЯ ОБЯЗАТЕЛЬНА ДЛЯ БРИГАДЫ. Без неё сверять бригаду не с чем, и
 * молча пускать нельзя: отсутствие организации бригадой не покрывается, остаётся
 * только прямое назначение (отказ вместо послабления).
 */
export async function assertReportOwnerOnSite(
  userId: string,
  siteId: string,
  tenantId?: string | null
) {
  const assignment = await db.userSiteAssignment.findUnique({
    where: { userId_siteId: { userId, siteId } },
    select: { id: true },
  });
  if (assignment) return;

  if (tenantId) {
    const crew = await db.crew.findFirst({
      where: {
        operatorId: userId, siteId, isActive: true,
        equipment: { tenantId }, site: { tenantId },
      },
      select: { id: true },
    });
    if (crew) return;
  }

  throw new ServiceError('Нет доступа к этому объекту', 403);
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
