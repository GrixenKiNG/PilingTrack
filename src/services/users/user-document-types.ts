import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { recordAuditEvent } from '@/services/audit/audit-service';
import {
  assertCanManageTypes,
  type UserDocumentContext,
} from './user-document-access';

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
  /** Без документа этого вида оператор к смене не допускается. */
  requiredForOperator?: boolean;
  isActive?: boolean;
  notes?: string;
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
      requiredForOperator: input.requiredForOperator ?? false,
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
  if (input.requiredForOperator !== undefined) data.requiredForOperator = input.requiredForOperator;
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
