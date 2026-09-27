/**
 * Хранение и публикация матрицы доступов.
 *
 * Приём тот же, что у правил готовности (`readiness-rules-service.ts`):
 * черновик копится отдельной строкой, публикация переводит его в действующую
 * версию, прежняя уходит в архив. Каждое действие подписывается именем, ролью
 * и замещением — по решению владельца именно журнал, а не запрет, отвечает на
 * вопрос «кто менял доступы».
 */

import type { Prisma } from '@/generated/postgres-client/client';
import { db } from '@/lib/db';
import {
  DEFAULT_ACCESS_MATRIX,
  describeAccessChanges,
  sanitizeAccessMatrix,
  type ReadinessAccessMatrix,
} from '../domain/access-matrix';
import { bumpVersion } from '../domain/readiness-rules';
import { recordChainedReadinessAudit } from '../infrastructure/audit/record-audit';

export interface AccessMatrixState {
  published: ReadinessAccessMatrix;
  draft: ReadinessAccessMatrix | null;
  pendingChanges: number;
  /**
   * Лежит ли действующая версия в базе. Если нет — `published` это значения по
   * умолчанию из кода, и экран обязан сказать об этом честно: доступы работают,
   * но организация их не принимала.
   */
  publishedInDb: boolean;
}

type MatrixRow = {
  version: string;
  status: string;
  grants: Prisma.JsonValue;
  updatedAt: Date;
  updatedBy: string | null;
  publishedAt: Date | null;
};

function toMatrix(row: MatrixRow, fallback = DEFAULT_ACCESS_MATRIX): ReadinessAccessMatrix {
  return sanitizeAccessMatrix({
    version: row.version,
    status: row.status,
    grants: row.grants,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? undefined,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }, fallback);
}

export async function getAccessMatrix(
  tenantId: string,
  // Клиент передаётся там, где вызов уже внутри транзакции: читать через
  // глобальный `db` изнутри транзакции — значит выйти из неё и завести второе
  // подключение, а вместе с ним и незащищённое чтение черновика (F-R38-10).
  client: Pick<typeof db, 'readinessAccessMatrix'> = db,
): Promise<AccessMatrixState> {
  if (!tenantId) throw new Error('getAccessMatrix: tenantId is required');
  const rows = await client.readinessAccessMatrix.findMany({
    where: { tenantId, status: { in: ['PUBLISHED', 'DRAFT'] } },
    orderBy: { updatedAt: 'desc' },
  });
  const publishedRow = rows.find((row) => row.status === 'PUBLISHED');
  const published = publishedRow ? toMatrix(publishedRow) : DEFAULT_ACCESS_MATRIX;
  const draftRow = rows.find((row) => row.status === 'DRAFT');
  const draft = draftRow ? toMatrix(draftRow, published) : null;
  return {
    published,
    draft,
    pendingChanges: draft ? describeAccessChanges(published, draft).length : 0,
    publishedInDb: Boolean(publishedRow),
  };
}

/**
 * Действующая матрица для проверки прав. Отдельная функция, потому что
 * вызывается на каждом запросе и черновик её не касается: пока не опубликовали
 * — работает прежняя версия.
 */
export async function getPublishedAccessMatrix(
  tenantId: string,
  // Клиент передаётся там, где вызов уже внутри транзакции (bootstrap):
  // читать через глобальный `db` изнутри транзакции — значит выйти из неё и
  // завести второе подключение, а заодно сделать функцию непроверяемой в
  // юнит-тестах, где базы нет.
  client: Pick<typeof db, 'readinessAccessMatrix'> = db,
): Promise<ReadinessAccessMatrix> {
  if (!tenantId) throw new Error('getPublishedAccessMatrix: tenantId is required');
  const row = await client.readinessAccessMatrix.findFirst({
    where: { tenantId, status: 'PUBLISHED' },
    orderBy: { updatedAt: 'desc' },
  });
  return row ? toMatrix(row) : DEFAULT_ACCESS_MATRIX;
}

interface MatrixActor { id: string; name: string; role: string; actingAs?: string | null }

/**
 * Тело события цепочки — канонический JSON: ключ со значением `undefined`
 * роняет запись («Audit JSON contains unsupported undefined»), а у матрицы
 * необязательные `updatedAt`/`updatedBy` всегда лежат ключом. Отсутствие
 * значения записываем как `null` — так строка и читается журналом.
 */
function matrixPayload(matrix: ReadinessAccessMatrix) {
  return {
    version: matrix.version,
    status: matrix.status,
    grants: matrix.grants,
    updatedAt: matrix.updatedAt ?? null,
    updatedBy: matrix.updatedBy ?? null,
    publishedAt: matrix.publishedAt ?? null,
  };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    action: 'draft_saved' | 'published';
    entityId: string;
    actor: MatrixActor;
    before?: ReadinessAccessMatrix | null;
    after: ReadinessAccessMatrix;
  },
) {
  /*
    Через цепочечный писатель, а не `tx.auditLog.create`: читатель журнала
    (`audit-repository.ts` readChain) отбирает звенья по `hash: {not: null}`,
    поэтому прямая запись не попадала ни на экран «Аудит», ни в проверку
    цепочки — смена прав оставалась без читаемого следа.
  */
  await recordChainedReadinessAudit(tx, {
    tenantId: input.tenantId,
    action: input.action,
    entityType: 'ReadinessAccessMatrix',
    entityId: input.entityId,
    actor: {
      id: input.actor.id,
      name: input.actor.name,
      role: input.actor.role,
      actingAs: input.actor.actingAs ?? null,
    },
    before: input.before ? matrixPayload(input.before) : null,
    after: {
      version: input.after.version,
      grants: input.after.grants,
      // Список отличий — то, ради чего журнал и читают: «кому что выдали».
      changes: input.before ? describeAccessChanges(input.before, input.after) : [],
    },
  });
}

export async function saveAccessMatrixDraft(
  tenantId: string,
  patch: unknown,
  actor: MatrixActor,
): Promise<AccessMatrixState> {
  if (!tenantId) throw new Error('saveAccessMatrixDraft: tenantId is required');

  await db.$transaction(async (tx) => {
    // Два администратора, сохраняющих черновик одновременно, без замка успевают
    // оба не найти действующий DRAFT и создать по своему — в организации
    // оказывается два черновика матрицы. Замок транзакционный, снимается сам
    // при коммите или откате; чтение черновика и его запись идут под ним одной
    // транзакцией (F-R38-10).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`readiness-draft:matrix:${tenantId}`}))`;

    const state = await getAccessMatrix(tenantId, tx);
    const next = sanitizeAccessMatrix(patch, state.draft ?? state.published);
    const existing = await tx.readinessAccessMatrix.findFirst({
      where: { tenantId, status: 'DRAFT' },
      select: { id: true },
    });

    const data = {
      version: bumpVersion(state.published.version),
      grants: next.grants as unknown as Prisma.InputJsonValue,
      updatedBy: actor.id,
    };
    const row = existing
      ? await tx.readinessAccessMatrix.update({ where: { id: existing.id }, data })
      : await tx.readinessAccessMatrix.create({ data: { tenantId, status: 'DRAFT', ...data } });
    await writeAudit(tx, {
      tenantId, action: 'draft_saved', entityId: row.id, actor,
      before: state.draft ?? state.published, after: next,
    });
  });
  return getAccessMatrix(tenantId);
}

export async function publishAccessMatrix(
  tenantId: string,
  actor: MatrixActor,
): Promise<AccessMatrixState> {
  if (!tenantId) throw new Error('publishAccessMatrix: tenantId is required');

  await db.$transaction(async (tx) => {
    // Тот же ресурс, что и у сохранения черновика: публикация и сохранение,
    // идущие одновременно, обязаны сериализоваться. Иначе сохранение,
    // начатое до публикации, правит своим `update` по id уже опубликованную
    // матрицу — действующие права меняются без публикации и без черновика
    // (F-R38-10). Замок транзакционный, снимается сам при коммите или откате.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`readiness-draft:matrix:${tenantId}`}))`;

    const state = await getAccessMatrix(tenantId, tx);
    const draftRow = await tx.readinessAccessMatrix.findFirst({
      where: { tenantId, status: 'DRAFT' },
    });

    // Публиковать нечего только когда действующая версия уже в базе. У нового
    // тенанта её нет: экран показывает значения из кода, и первое нажатие
    // «Опубликовать» должно закрепить именно их, а не промолчать.
    if (!draftRow) {
      if (state.publishedInDb) return;
      const published = await tx.readinessAccessMatrix.create({
        data: {
          tenantId,
          status: 'PUBLISHED',
          version: state.published.version,
          grants: state.published.grants as unknown as Prisma.InputJsonValue,
          publishedAt: new Date(),
          updatedBy: actor.id,
        },
      });
      await writeAudit(tx, {
        tenantId, action: 'published', entityId: published.id, actor, after: state.published,
      });
      return;
    }

    await tx.readinessAccessMatrix.updateMany({
      where: { tenantId, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    });
    const published = await tx.readinessAccessMatrix.update({
      where: { id: draftRow.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), updatedBy: actor.id },
    });
    await writeAudit(tx, {
      tenantId, action: 'published', entityId: published.id, actor,
      before: state.published, after: toMatrix(published, state.published),
    });
  });
  return getAccessMatrix(tenantId);
}
