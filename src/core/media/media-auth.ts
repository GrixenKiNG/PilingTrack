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

  throw new ServiceError(`Operators cannot manage media for entity type ${entityType}`, 403);
}

/**
 * Authorize an action against an existing media record (confirm/delete/download).
 *
 * Admins/dispatchers always allowed. Other roles: must own the upload. We
 * deliberately don't fall through to entity ownership here because the
 * media is the source of truth once it exists, and entity ownership might
 * not exist (draft) or may have changed (admin reassigned the report).
 */
export function assertCanAccessMedia(actor: ActorLike, media: MediaContext): void {
  if (isPrivilegedRole(actor.role)) return;
  if (media.userId === actor.id) return;
  throw new ServiceError('Forbidden', 403);
}
