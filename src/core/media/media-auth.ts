// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { isPrivilegedRole } from '@/services/auth/authorization-service';
import { ServiceError } from '@/lib/service-error';

interface ActorLike {
  id: string;
  role: string;
  tenantId?: string | null;
}

interface MediaContext {
  userId: string;
  entityType: string | null;
  entityId: string | null;
  tenantId?: string | null;
}

/**
 * Whether the actor may attach/list media for the given entity.
 *
 * Important: operators pre-generate the reportId on the client so they can
 * attach a photo *before* submitting the report. So the report row does not
 * exist in the DB yet — checking report ownership in that window would 404
 * the upload widget on every fresh form. We treat "report not yet persisted"
 * as allowed; the worst case is an orphan media record (cleaned up by
 * retention) since an unsubmitted reportId never becomes addressable.
 */
export async function assertCanAccessMediaEntity(
  actor: ActorLike,
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): Promise<void> {
  if (entityType === 'equipment') {
    if (actor.role !== 'ADMIN') throw new ServiceError('Only admins can manage equipment photos', 403);
    return;
  }

  if (isPrivilegedRole(actor.role)) return;

  if (!entityType || !entityId) {
    throw new ServiceError('entityType and entityId are required for non-admin users', 400);
  }

  if (entityType === 'report') {
    const { db } = await import('@/lib/db');
    const report = await db.report.findFirst({
      where: { OR: [{ id: entityId }, { reportId: entityId }] },
      select: { userId: true },
    });
    if (!report) return; // draft id — operator hasn't submitted yet
    if (report.userId !== actor.id) throw new ServiceError('Forbidden', 403);
    return;
  }

  // Фото к пункту осмотра. entityId — составной `${inspectionId}__${itemId}`.
  //
  // Оператор проводит сменный осмотр (право `inspection.perform`), а часть
  // пунктов чек-листа не завершить без снимка. Без этой ветки осмотр для него
  // упирался в тупик: ответы сохранялись, а завершение отвечало «без
  // обязательного фото». Доступ сужен до своего осмотра — тем же правилом,
  // что и сам осмотр.
  if (entityType === 'inspection') {
    const inspectionId = entityId.split('__')[0];
    if (!inspectionId) throw new ServiceError('Forbidden', 403);
    const { db } = await import('@/lib/db');
    const inspection = await db.inspection.findUnique({
      where: { id: inspectionId },
      select: { performedById: true },
    });
    if (!inspection) throw new ServiceError('Forbidden', 403);
    if (inspection.performedById !== actor.id) throw new ServiceError('Forbidden', 403);
    return;
  }

  throw new ServiceError(`Загрузка файлов к «${entityType}» для вашей роли недоступна`, 403);
}

/**
 * Authorize an action against an existing media record (confirm/delete/download).
 *
 * Equipment photos are org-wide assets, not personal uploads: every role on
 * the fleet dashboard must be able to READ them (tenant-scoped, fail-closed),
 * while only ADMIN may mutate — mirroring assertCanAccessMediaEntity above.
 *
 * For everything else: admins/dispatchers allowed, other roles must own the
 * upload. We deliberately don't fall through to entity ownership because the
 * media is the source of truth once it exists, and entity ownership might
 * not exist (draft) or may have changed (admin reassigned the report).
 */
export function assertCanAccessMedia(
  actor: ActorLike,
  media: MediaContext,
  action: 'read' | 'mutate' = 'mutate',
): void {
  if (media.entityType === 'equipment') {
    if (action === 'read') {
      if (!actor.tenantId || !media.tenantId || actor.tenantId !== media.tenantId) {
        throw new ServiceError('Forbidden', 403);
      }
      return;
    }
    if (actor.role !== 'ADMIN') throw new ServiceError('Only admins can manage equipment photos', 403);
    return;
  }

  if (isPrivilegedRole(actor.role)) return;
  if (media.userId === actor.id) return;
  throw new ServiceError('Forbidden', 403);
}
