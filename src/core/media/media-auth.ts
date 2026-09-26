// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { can, isPrivilegedRole } from '@/services/auth/authorization-service';
import { resolveEffectiveRole } from '@/lib/types';
import { ServiceError } from '@/lib/service-error';

interface ActorLike {
  id: string;
  role: string;
  tenantId?: string | null;
  actingAs?: string | null;
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
  action: 'read' | 'mutate' = 'mutate',
): Promise<void> {
  if (entityType === 'equipment') {
    if (action === 'read' && actor.tenantId && can(actor, 'equipment.read')) return;
    if (resolveEffectiveRole(actor.role, actor.actingAs) !== 'ADMIN') throw new ServiceError('Только администратор может управлять фото установок', 403);
    return;
  }

  if (isPrivilegedRole(resolveEffectiveRole(actor.role, actor.actingAs))) return;

  if (!entityType || !entityId) {
    throw new ServiceError('Не указано, к какому объекту относится файл', 400);
  }

  if (entityType === 'report') {
    const { db } = await import('@/lib/db');
    const report = await db.report.findFirst({
      where: { OR: [{ id: entityId }, { reportId: entityId }] },
      select: { userId: true, tenantId: true },
    });
    if (!report) return; // draft id — operator hasn't submitted yet
    if (action === 'read' && actor.tenantId && report.tenantId === actor.tenantId && can(actor, 'reports.read_cross_user')) return;
    if (report.userId !== actor.id) throw new ServiceError('Нет доступа', 403);
    return;
  }

  // Фото к опасному событию или дефекту снимается до отправки самой команды.
  // entityId здесь равен commandId: после подтверждения загрузки команда
  // проверит владельца, организацию, тип, этот идентификатор и image/*.
  if (entityType === 'safety_incident' || entityType === 'equipment_defect') {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(entityId)) {
      throw new ServiceError('Некорректный идентификатор события для фотографии', 400);
    }
    return;
  }

  // Фото к пункту осмотра. entityId — составной `${inspectionId}__${itemId}`.
  //
  // Оператор проводит сменный осмотр (право `inspection.perform`), а часть
  // пунктов чек-листа не завершить без снимка. Без этой ветки осмотр для него
  // упирался в тупик: ответы сохранялись, а завершение отвечало «без
  // обязательного фото». Доступ сужен до своего осмотра — тем же правилом,
  // что и сам осмотр.
  if (entityType === 'maintenance') {
    const { db } = await import('@/lib/db');
    const record = await db.maintenanceRecord.findUnique({ where: { id: entityId }, select: { tenantId: true } });
    if (!actor.tenantId || record?.tenantId !== actor.tenantId || !can(actor, 'maintenance.manage')) {
      throw new ServiceError('Нет доступа', 403);
    }
    return;
  }

  if (entityType === 'inspection') {
    const inspectionId = entityId.split('__')[0];
    if (!inspectionId) throw new ServiceError('Нет доступа', 403);
    const { db } = await import('@/lib/db');
    const inspection = await db.inspection.findUnique({
      where: { id: inspectionId },
      select: { performedById: true, tenantId: true },
    });
    if (!inspection) throw new ServiceError('Нет доступа', 403);
    if (action === 'read' && actor.tenantId && inspection.tenantId === actor.tenantId && can(actor, 'maintenance.manage')) return;
    if (inspection.performedById !== actor.id) throw new ServiceError('Нет доступа', 403);
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
export interface ReadableMediaRow extends MediaContext {
  id: string;
  key: string;
  thumbnailKey: string | null;
  isDeleted: boolean;
  uploadStatus: string;
}

/**
 * Отобрать из пачки записи, которые актору можно читать.
 *
 * Пакетная выдача ссылок отличается от выдачи по одной тем, что проверка
 * доступа перестаёт быть «пропустить или ответить 403» и становится отбором:
 * одна чужая запись в ответе утечёт молча, её никто не заметит. Поэтому
 * решение по каждой строке принимает тот же `assertCanAccessMedia`, что и
 * одиночный маршрут, — своей копии правил здесь нет и быть не должно.
 *
 * Запрещённая запись именно выбрасывается, а не роняет весь запрос: список из
 * двадцати миниатюр не должен переставать работать целиком из-за одной чужой
 * строки. Заодно ответ не сообщает, существует ли недоступный id.
 */
export function filterReadableMedia(
  actor: ActorLike,
  rows: ReadableMediaRow[],
): ReadableMediaRow[] {
  return rows.filter((media) => {
    if (media.isDeleted || media.uploadStatus !== 'completed') return false;
    try {
      assertCanAccessMedia(actor, media, 'read');
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Файл, приложенный к документу работника, читает и сам работник.
 *
 * Общее правило ниже даёт доступ ЗАГРУЗИВШЕМУ (`media.userId === actor.id`),
 * а удостоверения, медосмотры и допуски по охране труда загружает за
 * работника администратор. Из-за этого человек получал 403 на собственный
 * документ: файл его, а запись о загрузке — чужая.
 *
 * Отдельного `entityType` у таких вложений нет — связь идёт через
 * `UserDocument.mediaId`, поэтому спрашиваем базу. Организация сверяется
 * строгим равенством и закрывается при отсутствии: тенант без значения
 * доступа не даёт (правило проекта против IDOR).
 */
export async function ownsUserDocumentMedia(
  actor: ActorLike,
  mediaId: string,
): Promise<boolean> {
  if (!actor.tenantId) return false;
  const { db } = await import('@/lib/db');
  const document = await db.userDocument.findFirst({
    where: { mediaId, userId: actor.id, tenantId: actor.tenantId },
    select: { id: true },
  });
  return document !== null;
}

export function assertCanAccessMedia(
  actor: ActorLike,
  media: MediaContext,
  action: 'read' | 'mutate' = 'mutate',
): void {
  if (media.entityType === 'equipment') {
    if (action === 'read') {
      if (!actor.tenantId || !media.tenantId || actor.tenantId !== media.tenantId) {
        throw new ServiceError('Нет доступа', 403);
      }
      return;
    }
    if (resolveEffectiveRole(actor.role, actor.actingAs) !== 'ADMIN') throw new ServiceError('Только администратор может управлять фото установок', 403);
    return;
  }

  if (isPrivilegedRole(resolveEffectiveRole(actor.role, actor.actingAs))) return;
  if (media.userId === actor.id) return;
  if (action === 'read' && actor.tenantId && media.tenantId === actor.tenantId) {
    if ((media.entityType === 'inspection' || media.entityType === 'maintenance') && can(actor, 'maintenance.manage')) return;
    if (media.entityType === 'report' && can(actor, 'reports.read_cross_user')) return;
  }
  throw new ServiceError('Нет доступа', 403);
}
