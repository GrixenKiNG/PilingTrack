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
 *
 * Проверки прав и тенанта, справочник видов документов вынесены в соседние
 * модули (`user-document-access.ts`, `user-document-types.ts`) и ре-экспортируются
 * отсюда: точка входа остаётся прежней — `@/services/users/user-documents`.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { can } from '@/services/auth/authorization-service';
import { documentExpiry } from '@/lib/document-expiry';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { evaluateOperatorClearance, type OperatorClearance } from './operator-clearance';
import {
  assertCanRead,
  assertCanWrite,
  requireAttachableMedia,
  requireOwnDocument,
  requireTenantDocumentType,
  requireTenantUser,
  type UserDocumentContext,
} from './user-document-access';

export {
  listUserDocumentTypes,
  listUserDocumentTypesForAdmin,
  createUserDocumentType,
  updateUserDocumentType,
  deleteUserDocumentType,
} from './user-document-types';
export type { UserDocumentTypeInput } from './user-document-types';
export type { UserDocumentContext } from './user-document-access';

export interface UserDocumentInput {
  typeId: string;
  number?: string;
  issuedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  notes?: string;
  mediaId?: string | null;
}

/**
 * Достаточно двух таблиц — поэтому принимаем не весь клиент, а его срез.
 * Так вызов проходит и снаружи транзакции, и внутри чужой: контур готовности
 * считает допуск в той же транзакции, что и пуск смены, иначе проверка шла бы
 * по другому снимку данных, чем сам переход.
 */
type DocumentReader = Pick<typeof db, 'userDocumentType' | 'userDocument'>;

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const DAY_MS = 86_400_000;

/**
 * Самое дальнее окно предупреждения среди видов документов тенанта (в днях).
 * Нужно, чтобы отсечь в SQL документы, которые заведомо не пройдут фильтр
 * «просрочен / истекает» (см. `document-expiry.ts`): если документ истекает
 * позже, чем `now + maxLeadTime`, он не «истекает» для вида ни с каким
 * `leadTimeDays`.
 */
async function maxDocumentTypeLeadTimeDays(tenantId: string): Promise<number> {
  const types = await db.userDocumentType.findMany({
    where: { tenantId },
    select: { leadTimeDays: true },
  });
  return Math.max(0, ...types.map((type) => type.leadTimeDays ?? 0));
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

  // Отсекаем в SQL всё, что заведомо не пройдёт JS-фильтр ниже: документ не
  // «истекает» ни для одного вида, если истекает позже now + maxLeadTime.
  // Фильтр по дате использует индекс (tenantId, expiresAt), а `user.isActive`
  // тоже переносим в `where`, чтобы не материализовать документы
  // уволенных/отключённых работников.
  const maxLeadTimeDays = await maxDocumentTypeLeadTimeDays(ctx.tenantId);

  const rows = await db.userDocument.findMany({
    where: {
      tenantId: ctx.tenantId,
      expiresAt: {
        not: null,
        lte: new Date(now.getTime() + maxLeadTimeDays * DAY_MS),
      },
      user: { is: { isActive: true } },
    },
    include: {
      type: { select: { id: true, name: true, leadTimeDays: true } },
      user: { select: { id: true, name: true, role: true, isActive: true } },
    },
    orderBy: { expiresAt: 'asc' },
  });

  return rows
    .map((row) => ({ ...row, expiry: documentExpiry(row.expiresAt, row.type.leadTimeDays, now) }))
    .filter((row) => row.expiry.status === 'expired' || row.expiry.status === 'expiring');
}

/**
 * Допущен ли работник к смене по документам.
 *
 * Прав здесь не спрашиваем сознательно: функция вызывается серверной командой
 * пуска смены и экраном самого оператора, наружу отдаются только названия видов
 * документов и сроки — ни номеров, ни сканов. Вызывающий обязан ограничить
 * выборку своим тенантом, что и делает аргумент `tenantId`.
 *
 * Нет обязательных видов — допуск чист: система не выдумывает требований,
 * которых администратор не заводил.
 */
export async function getOperatorClearance(
  tenantId: string,
  userId: string,
  now: Date = new Date(),
  client: DocumentReader = db,
): Promise<OperatorClearance> {
  if (!tenantId) throw new ServiceError('Не определена организация пользователя', 400);

  const required = await client.userDocumentType.findMany({
    where: { tenantId, isActive: true, requiredForOperator: true },
    select: { id: true, name: true, leadTimeDays: true },
  });
  if (required.length === 0) return { cleared: true, blockers: [], warnings: [], documents: [] };

  const held = await client.userDocument.findMany({
    where: { tenantId, userId, typeId: { in: required.map((type) => type.id) } },
    select: { typeId: true, expiresAt: true },
  });

  return evaluateOperatorClearance(required, held, now);
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
  const issuedAt = toDate(input.issuedAt);
  assertDocumentDatesOrdered(issuedAt, expiresAt);

  if (input.mediaId) await requireAttachableMedia(input.mediaId, user.id, ctx);

  const created = await db.userDocument.create({
    data: {
      tenantId: ctx.tenantId,
      userId: user.id,
      typeId: type.id,
      number: input.number?.trim() ?? '',
      issuedAt,
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

/**
 * Срок действия не может кончиться раньше, чем документ выдан.
 *
 * Проверки не было ни на одном из двух путей записи, и в базе оказывались
 * документы с выдачей 06.09 и окончанием 01.09. Контроль просрочки считает
 * такой документ давно недействительным, а человек видит свежую дату выдачи
 * и не понимает, почему его не допускают.
 *
 * Равные даты допускаются: разрешение на один день — не ошибка.
 */
function assertDocumentDatesOrdered(issuedAt: Date | null, expiresAt: Date | null) {
  if (issuedAt && expiresAt && expiresAt.getTime() < issuedAt.getTime()) {
    throw new ServiceError(
      'Дата окончания раньше даты выдачи — проверьте документ',
      400,
    );
  }
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
  if (input.mediaId !== undefined) {
    const mediaId = input.mediaId || null;
    // Тот же файл, что уже подшит, не перепроверяем: скан мог загрузить
    // администратор, и без этого работник не сохранил бы правку своего документа.
    if (mediaId && mediaId !== existing.mediaId) await requireAttachableMedia(mediaId, userId, ctx);
    data.mediaId = mediaId;
  }

  if (input.expiresAt !== undefined && data.expiresAt == null) {
    const typeId = (data.typeId as string | undefined) ?? existing.typeId;
    const type = await requireTenantDocumentType(typeId, ctx.tenantId);
    if (type.requiresExpiry) {
      throw new ServiceError(`Для документа «${type.name}» нужно указать срок действия`, 400);
    }
  }

  // Сверяем итоговую пару, а не присланную: меняться может одна дата.
  assertDocumentDatesOrdered(
    input.issuedAt !== undefined ? (data.issuedAt as Date | null) : existing.issuedAt,
    input.expiresAt !== undefined ? (data.expiresAt as Date | null) : existing.expiresAt,
  );

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
