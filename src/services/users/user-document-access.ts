import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { can, type SessionActor } from '@/services/auth/authorization-service';

export interface UserDocumentContext {
  tenantId: string;
  actor: SessionActor;
}

/** Работник существует и принадлежит тенанту действующего пользователя. */
export async function requireTenantUser(userId: string, tenantId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, name: true },
  });
  if (!user) throw new ServiceError('Пользователь не найден', 404);
  return user;
}

export function assertCanRead(targetUserId: string, ctx: UserDocumentContext) {
  if (ctx.actor.id === targetUserId) return;
  if (can(ctx.actor, 'users.documents.read_all')) return;
  throw new ServiceError('Недостаточно прав для просмотра документов работника', 403);
}

export function assertCanWrite(targetUserId: string, ctx: UserDocumentContext) {
  if (ctx.actor.id === targetUserId) return;
  if (can(ctx.actor, 'users.manage')) return;
  throw new ServiceError('Недостаточно прав для изменения документов работника', 403);
}

/** Вид документа из справочника того же тенанта и не отключённый. */
export async function requireTenantDocumentType(typeId: string, tenantId: string) {
  const type = await db.userDocumentType.findFirst({
    where: { id: typeId, tenantId, isActive: true },
    select: { id: true, requiresExpiry: true, name: true },
  });
  if (!type) throw new ServiceError('Вид документа не найден', 404);
  return type;
}

/**
 * Файл можно подшить к документу только если он реально принадлежит этому
 * документу (или его владелец — действующий админ). Иначе запись `mediaId`
 * превращала бы чужой загруженный файл в «свой»: работник выучил id чужого
 * удостоверения, подшил его к своему документу и скачивал через этот маршрут.
 *
 * Разрешаем два пути, оба строго:
 *   — файл загрузил сам владелец документа (`media.userId === ownerUserId`);
 *   — файл загрузил действующий пользователь `users.manage` (админ ведёт
 *     документы работников и загружает сканы за них).
 * Тенант, статус загрузки и флаг удаления сверяем всегда.
 */
export async function requireAttachableMedia(mediaId: string, ownerUserId: string, ctx: UserDocumentContext) {
  const media = await db.media.findUnique({
    where: { id: mediaId },
    select: { id: true, tenantId: true, userId: true, uploadStatus: true, isDeleted: true },
  });
  const isOwnedByDocumentOwner = media?.userId === ownerUserId;
  const isUploadedByActingManager =
    media?.userId === ctx.actor.id && can(ctx.actor, 'users.manage');
  if (
    !media ||
    media.tenantId !== ctx.tenantId ||
    media.uploadStatus !== 'completed' ||
    media.isDeleted ||
    (!isOwnedByDocumentOwner && !isUploadedByActingManager)
  ) {
    throw new ServiceError('Файл недоступен для прикрепления к документу', 403);
  }
}

export function assertCanManageTypes(ctx: UserDocumentContext): void {
  if (can(ctx.actor, 'users.manage')) return;
  throw new ServiceError('Недостаточно прав для изменения справочника видов документов', 403);
}

export async function requireOwnDocument(userId: string, documentId: string, tenantId: string) {
  const document = await db.userDocument.findFirst({
    where: { id: documentId, userId, tenantId },
    // Даты нужны целиком: правка одной из них проверяется против второй,
    // которая осталась в записи.
    select: { id: true, typeId: true, issuedAt: true, expiresAt: true, mediaId: true },
  });
  if (!document) throw new ServiceError('Документ не найден', 404);
  return document;
}
