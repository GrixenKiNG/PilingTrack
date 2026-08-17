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

export async function getAccessMatrix(tenantId: string): Promise<AccessMatrixState> {
  if (!tenantId) throw new Error('getAccessMatrix: tenantId is required');
  const rows = await db.readinessAccessMatrix.findMany({
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
  await tx.auditLog.create({
    data: {
      entity: 'ReadinessAccessMatrix',
      action: input.action,
      entityId: input.entityId,
      before: input.before ? input.before as unknown as Prisma.InputJsonValue : undefined,
      after: {
        version: input.after.version,
        grants: input.after.grants,
        // Список отличий — то, ради чего журнал и читают: «кому что выдали».
        changes: input.before ? describeAccessChanges(input.before, input.after) : [],
      } as unknown as Prisma.InputJsonValue,
      userId: input.actor.id,
      userName: input.actor.name,
      userRole: input.actor.role,
      actingAs: input.actor.actingAs ?? null,
      tenantId: input.tenantId,
    },
  });
}

export async function saveAccessMatrixDraft(
  tenantId: string,
  patch: unknown,
  actor: MatrixActor,
): Promise<AccessMatrixState> {
  if (!tenantId) throw new Error('saveAccessMatrixDraft: tenantId is required');
  const state = await getAccessMatrix(tenantId);
  const next = sanitizeAccessMatrix(patch, state.draft ?? state.published);
  const existing = await db.readinessAccessMatrix.findFirst({
    where: { tenantId, status: 'DRAFT' },
    select: { id: true },
  });

  await db.$transaction(async (tx) => {
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
  const state = await getAccessMatrix(tenantId);
  const draftRow = await db.readinessAccessMatrix.findFirst({
    where: { tenantId, status: 'DRAFT' },
  });

  // Публиковать нечего только когда действующая версия уже в базе. У нового
  // тенанта её нет: экран показывает значения из кода, и первое нажатие
  // «Опубликовать» должно закрепить именно их, а не промолчать.
  if (!draftRow) {
    if (state.publishedInDb) return state;
    await db.$transaction(async (tx) => {
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
    });
    return getAccessMatrix(tenantId);
  }

  await db.$transaction(async (tx) => {
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
