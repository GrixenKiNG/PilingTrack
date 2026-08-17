/**
 * Документы работника: права на управление установкой, медосмотр, охрана
 * труда, аттестация по промбезопасности.
 *
 * Кто что может (правило одно, живёт здесь, а не размазано по маршрутам):
 *   — свои документы работник видит и ведёт сам;
 *   — чужие ВИДЯТ админ, диспетчер и инженер ОТ (`users.documents.read_all`) —
 *     без этого диспетчеру нечем контролировать просрочку перед сменой;
 *   — чужие ЗАВОДИТ, правит и удаляет только админ (`users.manage`).
 *
 * Тенант берётся из действующего пользователя и проверяется явно: и работник,
 * и вид документа обязаны принадлежать тому же тенанту. Без этой проверки
 * админ одного тенанта смог бы подшить документ работнику другого — та самая
 * межтенантная дыра, что уже ловилась в проекте (CLAUDE.md, IDOR 2026-05-31).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { can, type SessionActor } from '@/services/auth/authorization-service';
import { documentExpiry } from '@/lib/document-expiry';
import { recordAuditEvent } from '@/services/audit/audit-service';

export interface UserDocumentInput {
  typeId: string;
  number?: string;
  issuedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  notes?: string;
  mediaId?: string | null;
}

export interface UserDocumentContext {
  tenantId: string;
  actor: SessionActor;
}

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Работник существует и принадлежит тенанту действующего пользователя. */
async function requireTenantUser(userId: string, tenantId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, tenantId },
    select: { id: true, name: true },
  });
  if (!user) throw new ServiceError('User not found', 404);
  return user;
}

function assertCanRead(targetUserId: string, ctx: UserDocumentContext) {
  if (ctx.actor.id === targetUserId) return;
  if (can(ctx.actor, 'users.documents.read_all')) return;
  throw new ServiceError('Недостаточно прав для просмотра документов работника', 403);
}

function assertCanWrite(targetUserId: string, ctx: UserDocumentContext) {
  if (ctx.actor.id === targetUserId) return;
  if (can(ctx.actor, 'users.manage')) return;
  throw new ServiceError('Недостаточно прав для изменения документов работника', 403);
}

/** Вид документа из справочника того же тенанта и не отключённый. */
async function requireTenantDocumentType(typeId: string, tenantId: string) {
  const type = await db.userDocumentType.findFirst({
    where: { id: typeId, tenantId, isActive: true },
    select: { id: true, requiresExpiry: true, name: true },
  });
  if (!type) throw new ServiceError('Вид документа не найден', 404);
  return type;
}

/**
 * Виды документов для формы. Отключённые не отдаём: ими нельзя заводить новые
 * документы, а старые продолжают жить со своим видом.
 */
export async function listUserDocumentTypes(tenantId: string) {
  return db.userDocumentType.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, requiresExpiry: true, defaultValidMonths: true, leadTimeDays: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Все виды, включая отключённые, — для экрана управления справочником.
 * Со счётчиком использования: вид, которым уже подшиты документы, удалять
 * нельзя, и администратор должен видеть это до попытки.
 */
export async function listUserDocumentTypesForAdmin(ctx: UserDocumentContext) {
  assertCanManageTypes(ctx);
  const types = await db.userDocumentType.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { documents: true } } },
  });
  return types.map(({ _count, ...type }) => ({ ...type, documentCount: _count.documents }));
}

export interface UserDocumentTypeInput {
  name: string;
  requiresExpiry?: boolean;
  defaultValidMonths?: number | null;
  leadTimeDays?: number;
  isActive?: boolean;
  notes?: string;
}

function assertCanManageTypes(ctx: UserDocumentContext): void {
  if (can(ctx.actor, 'users.manage')) return;
  throw new ServiceError('Недостаточно прав для изменения справочника видов документов', 403);
}

/**
 * Нормализованное имя — ключ уникальности внутри тенанта. Считаем так же, как
 * при заведении из сида: без регистра и лишних пробелов, иначе «Медосмотр» и
 * «медосмотр  » станут двумя разными видами одного и того же.
 */
const normalizeTypeName = (name: string): string =>
  name.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ');

export async function createUserDocumentType(input: UserDocumentTypeInput, ctx: UserDocumentContext) {
  assertCanManageTypes(ctx);
  const name = input.name.trim();
  if (name === '') throw new ServiceError('Укажите название вида документа', 400);

  const normalizedName = normalizeTypeName(name);
  const duplicate = await db.userDocumentType.findFirst({
    where: { tenantId: ctx.tenantId, normalizedName },
    select: { id: true, isActive: true },
  });
  if (duplicate) {
    throw new ServiceError(duplicate.isActive
      ? 'Такой вид документа уже есть'
      : 'Такой вид документа есть, но отключён — включите его вместо создания нового', 409);
  }

  const created = await db.userDocumentType.create({
    data: {
      tenantId: ctx.tenantId,
      name,
      normalizedName,
      requiresExpiry: input.requiresExpiry ?? true,
      defaultValidMonths: input.defaultValidMonths ?? null,
      leadTimeDays: input.leadTimeDays ?? 30,
      notes: input.notes?.trim() ?? '',
    },
  });
  await recordAuditEvent({
    action: 'user.document_type.created', scope: 'users',
    actorId: ctx.actor.id, targetId: created.id, tenantId: ctx.tenantId,
    metadata: { name: created.name },
  });
  return created;
}

export async function updateUserDocumentType(
  typeId: string,
  input: Partial<UserDocumentTypeInput>,
  ctx: UserDocumentContext,
) {
  assertCanManageTypes(ctx);
  const existing = await db.userDocumentType.findFirst({
    where: { id: typeId, tenantId: ctx.tenantId },
    select: { id: true, name: true },
  });
  if (!existing) throw new ServiceError('Вид документа не найден', 404);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === '') throw new ServiceError('Укажите название вида документа', 400);
    const normalizedName = normalizeTypeName(name);
    const clash = await db.userDocumentType.findFirst({
      where: { tenantId: ctx.tenantId, normalizedName, id: { not: typeId } },
      select: { id: true },
    });
    if (clash) throw new ServiceError('Такой вид документа уже есть', 409);
    data.name = name;
    data.normalizedName = normalizedName;
  }
  if (input.requiresExpiry !== undefined) data.requiresExpiry = input.requiresExpiry;
  if (input.defaultValidMonths !== undefined) data.defaultValidMonths = input.defaultValidMonths;
  if (input.leadTimeDays !== undefined) data.leadTimeDays = input.leadTimeDays;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.notes !== undefined) data.notes = input.notes.trim();

  const updated = await db.userDocumentType.update({ where: { id: typeId }, data });
  await recordAuditEvent({
    action: 'user.document_type.updated', scope: 'users',
    actorId: ctx.actor.id, targetId: typeId, tenantId: ctx.tenantId,
    metadata: { name: updated.name, changed: Object.keys(data) },
  });
  return updated;
}

/**
 * Удаление только неиспользованного вида. Вид, которым подшиты документы,
 * отключается (`isActive: false`) — иначе у живых документов исчез бы вид, а
 * вместе с ним и срок предупреждения, по которому считается просрочка.
 */
export async function deleteUserDocumentType(typeId: string, ctx: UserDocumentContext) {
  assertCanManageTypes(ctx);
  const existing = await db.userDocumentType.findFirst({
    where: { id: typeId, tenantId: ctx.tenantId },
    select: { id: true, name: true, _count: { select: { documents: true } } },
  });
  if (!existing) throw new ServiceError('Вид документа не найден', 404);
  if (existing._count.documents > 0) {
    throw new ServiceError(
      `Вид используется в ${existing._count.documents} документах — его можно отключить, но не удалить`,
      409,
    );
  }
  await db.userDocumentType.delete({ where: { id: typeId } });
  await recordAuditEvent({
    action: 'user.document_type.deleted', scope: 'users',
    actorId: ctx.actor.id, targetId: typeId, tenantId: ctx.tenantId,
    metadata: { name: existing.name },
  });
}

export async function listUserDocuments(userId: string, ctx: UserDocumentContext, now: Date = new Date()) {
  assertCanRead(userId, ctx);
  await requireTenantUser(userId, ctx.tenantId);

  const rows = await db.userDocument.findMany({
    where: { tenantId: ctx.tenantId, userId },
    include: { type: { select: { id: true, name: true, leadTimeDays: true, requiresExpiry: true } } },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
  });

  return rows.map((row) => ({
    ...row,
    expiry: documentExpiry(row.expiresAt, row.type.leadTimeDays, now),
  }));
}

/**
 * Что требует внимания по всем работникам — рабочая выборка диспетчера перед
 * сменой: просроченное и то, что истекает в окне предупреждения вида
 * документа.
 *
 * Окно берётся у каждого вида своё (`leadTimeDays`), а не общей константой:
 * удостоверение продлевают месяцами, и предупреждать о нём за те же три дня,
 * что о чём-то быстром, бессмысленно.
 *
 * Бессрочные документы сюда не попадают по определению — у них нет срока.
 */
export async function listDocumentsNeedingAttention(ctx: UserDocumentContext, now: Date = new Date()) {
  if (!can(ctx.actor, 'users.documents.read_all')) {
    throw new ServiceError('Недостаточно прав для контроля документов', 403);
  }

  const rows = await db.userDocument.findMany({
    where: { tenantId: ctx.tenantId, expiresAt: { not: null } },
    include: {
      type: { select: { id: true, name: true, leadTimeDays: true } },
      user: { select: { id: true, name: true, role: true, isActive: true } },
    },
    orderBy: { expiresAt: 'asc' },
  });

  return rows
    .filter((row) => row.user.isActive)
    .map((row) => ({ ...row, expiry: documentExpiry(row.expiresAt, row.type.leadTimeDays, now) }))
    .filter((row) => row.expiry.status === 'expired' || row.expiry.status === 'expiring');
}

export async function createUserDocument(
  userId: string,
  input: UserDocumentInput,
  ctx: UserDocumentContext,
) {
  assertCanWrite(userId, ctx);
  const user = await requireTenantUser(userId, ctx.tenantId);
  const type = await requireTenantDocumentType(input.typeId, ctx.tenantId);

  const expiresAt = toDate(input.expiresAt);
  // Вид документа сам говорит, обязателен ли срок: у бессрочных его не
  // спрашиваем, у остальных пустая дата означает, что контроль просрочки по
  // этому документу молча не сработает.
  if (type.requiresExpiry && expiresAt == null) {
    throw new ServiceError(`Для документа «${type.name}» нужно указать срок действия`, 400);
  }

  const created = await db.userDocument.create({
    data: {
      tenantId: ctx.tenantId,
      userId: user.id,
      typeId: type.id,
      number: input.number?.trim() ?? '',
      issuedAt: toDate(input.issuedAt),
      expiresAt,
      notes: input.notes?.trim() ?? '',
      mediaId: input.mediaId || null,
    },
  });
  await auditDocumentChange('created', ctx, created, user.id);
  return created;
}

/**
 * След в журнале. Нужен из-за того, что работник ведёт свои документы сам:
 * без записи он мог бы продлить себе срок действия удостоверения, и диспетчер,
 * которому предписано «контролировать правильность заполнения», не увидел бы
 * ни того, что дата менялась, ни кем.
 *
 * Пишем только сам факт и поля срока — номер и примечание правят свободно,
 * а вот дата окончания и вид документа определяют допуск к работе.
 */
function auditDocumentChange(
  action: 'created' | 'updated' | 'deleted',
  ctx: UserDocumentContext,
  document: { id: string; typeId?: string; expiresAt?: Date | null },
  targetUserId: string,
) {
  return recordAuditEvent({
    action: `user.document.${action}`,
    scope: 'users',
    actorId: ctx.actor.id,
    targetId: targetUserId,
    tenantId: ctx.tenantId,
    metadata: {
      documentId: document.id,
      typeId: document.typeId,
      expiresAt: document.expiresAt?.toISOString() ?? null,
      // Правка своих документов — отдельный повод присмотреться: контроль
      // здесь держится не на запрете, а на видимости.
      selfService: ctx.actor.id === targetUserId,
    },
  });
}

async function requireOwnDocument(userId: string, documentId: string, tenantId: string) {
  const document = await db.userDocument.findFirst({
    where: { id: documentId, userId, tenantId },
    select: { id: true, typeId: true },
  });
  if (!document) throw new ServiceError('Документ не найден', 404);
  return document;
}

export async function updateUserDocument(
  userId: string,
  documentId: string,
  input: Partial<UserDocumentInput>,
  ctx: UserDocumentContext,
) {
  assertCanWrite(userId, ctx);
  await requireTenantUser(userId, ctx.tenantId);
  const existing = await requireOwnDocument(userId, documentId, ctx.tenantId);

  const data: Record<string, unknown> = {};
  if (input.typeId !== undefined) {
    data.typeId = (await requireTenantDocumentType(input.typeId, ctx.tenantId)).id;
  }
  if (input.number !== undefined) data.number = input.number?.trim() ?? '';
  if (input.issuedAt !== undefined) data.issuedAt = toDate(input.issuedAt);
  if (input.expiresAt !== undefined) data.expiresAt = toDate(input.expiresAt);
  if (input.notes !== undefined) data.notes = input.notes?.trim() ?? '';
  if (input.mediaId !== undefined) data.mediaId = input.mediaId || null;

  if (input.expiresAt !== undefined && data.expiresAt == null) {
    const typeId = (data.typeId as string | undefined) ?? existing.typeId;
    const type = await requireTenantDocumentType(typeId, ctx.tenantId);
    if (type.requiresExpiry) {
      throw new ServiceError(`Для документа «${type.name}» нужно указать срок действия`, 400);
    }
  }

  const updated = await db.userDocument.update({ where: { id: documentId }, data });
  await auditDocumentChange('updated', ctx, updated, userId);
  return updated;
}

export async function deleteUserDocument(userId: string, documentId: string, ctx: UserDocumentContext) {
  assertCanWrite(userId, ctx);
  await requireTenantUser(userId, ctx.tenantId);
  const document = await requireOwnDocument(userId, documentId, ctx.tenantId);
  await db.userDocument.delete({ where: { id: documentId } });
  await auditDocumentChange('deleted', ctx, document, userId);
}
