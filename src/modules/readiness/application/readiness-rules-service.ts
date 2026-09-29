import type { Prisma } from '@/generated/postgres-client/client';
import { db } from '@/lib/db';
import {
  DEFAULT_READINESS_RULES,
  bumpVersion,
  describeRuleSetChanges,
  sanitizeRuleSet,
  type ReadinessRuleSet,
} from '../domain/readiness-rules';
import { requestReadinessSnapshot } from './projection/request-snapshot';
import { recordChainedReadinessAudit } from '../infrastructure/audit/record-audit';

export interface ReadinessRulesState {
  published: ReadinessRuleSet;
  draft: ReadinessRuleSet | null;
  pendingChanges: number;
  /**
   * Лежит ли действующая версия в базе. Если нет, `published` — это значения
   * по умолчанию из кода: экран обязан показать их как непринятые, а вычислитель
   * готовности такие правила не признаёт и блокирует расчёт.
   */
  publishedInDb: boolean;
}

function toRuleSet(
  row: {
    version: string;
    status: string;
    criteria: Prisma.JsonValue;
    blockers: Prisma.JsonValue;
    updatedAt: Date;
    updatedBy: string | null;
    publishedAt: Date | null;
  },
  fallback = DEFAULT_READINESS_RULES,
): ReadinessRuleSet {
  return sanitizeRuleSet({
    version: row.version,
    status: row.status,
    criteria: row.criteria,
    blockers: row.blockers,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? undefined,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }, fallback);
}

const diffCount = (draft: ReadinessRuleSet, published: ReadinessRuleSet): number =>
  describeRuleSetChanges(published, draft).length;

/**
 * Тело события цепочки — канонический JSON: ключ со значением `undefined`
 * роняет запись («Audit JSON contains unsupported undefined»), а у набора
 * правил необязательные `updatedAt`/`updatedBy` всегда лежат ключом. Отсутствие
 * значения записываем как `null` — так строка и читается журналом.
 */
function ruleSetPayload(rules: ReadinessRuleSet) {
  return {
    version: rules.version,
    status: rules.status,
    criteria: rules.criteria,
    blockers: rules.blockers,
    updatedAt: rules.updatedAt ?? null,
    updatedBy: rules.updatedBy ?? null,
    publishedAt: rules.publishedAt ?? null,
  };
}

export async function getReadinessRules(
  tenantId: string,
  // Клиент передаётся там, где вызов уже внутри транзакции: читать через
  // глобальный `db` изнутри транзакции — значит выйти из неё и завести второе
  // подключение, а вместе с ним и незащищённое чтение черновика (F-R38-10).
  client: Pick<typeof db, 'readinessRuleSet'> = db,
): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('getReadinessRules: tenantId is required');
  const rows = await client.readinessRuleSet.findMany({
    where: { tenantId, status: { in: ['PUBLISHED', 'DRAFT'] } },
    orderBy: { updatedAt: 'desc' },
  });
  const publishedRow = rows.find((row) => row.status === 'PUBLISHED');
  const published = publishedRow ? toRuleSet(publishedRow) : DEFAULT_READINESS_RULES;
  const draftRow = rows.find((row) => row.status === 'DRAFT');
  const draft = draftRow ? toRuleSet(draftRow, published) : null;
  return {
    published,
    draft,
    pendingChanges: draft ? diffCount(draft, published) : 0,
    publishedInDb: Boolean(publishedRow),
  };
}

export async function saveReadinessDraft(
  tenantId: string,
  patch: unknown,
  actor: { id: string; name: string; role: string },
): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('saveReadinessDraft: tenantId is required');

  await db.$transaction(async (tx) => {
    // Два администратора, сохраняющих черновик одновременно, без замка успевают
    // оба не найти действующий DRAFT и создать по своему — в организации
    // оказывается два черновика, и какой из них увидит экран, решает updatedAt.
    // Замок транзакционный, снимается сам при коммите или откате; чтение
    // черновика и его запись идут под ним одной транзакцией (F-R38-10).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`readiness-draft:rules:${tenantId}`}))`;

    const state = await getReadinessRules(tenantId, tx);
    const next = sanitizeRuleSet(patch, state.draft ?? state.published);
    const existing = await tx.readinessRuleSet.findFirst({
      where: { tenantId, status: 'DRAFT' },
      select: { id: true },
    });

    const data = {
      version: bumpVersion(state.published.version),
      criteria: next.criteria as unknown as Prisma.InputJsonValue,
      blockers: next.blockers as unknown as Prisma.InputJsonValue,
      updatedBy: actor.id,
    };
    const row = existing
      ? await tx.readinessRuleSet.update({ where: { id: existing.id }, data })
      : await tx.readinessRuleSet.create({
        data: { tenantId, status: 'DRAFT', ...data },
      });
    /*
      Через цепочечный писатель, а не `tx.auditLog.create`: читатель журнала
      (`audit-repository.ts` readChain) отбирает звенья по `hash: {not: null}`,
      поэтому прямая запись не попадала ни на экран «Аудит», ни в проверку
      цепочки — смена правил готовности оставалась без читаемого следа.
    */
    await recordChainedReadinessAudit(tx, {
      tenantId,
      action: 'draft_saved',
      entityType: 'ReadinessRuleSet',
      entityId: row.id,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      before: state.draft ? ruleSetPayload(state.draft) : null,
      after: ruleSetPayload(next),
    });
  });
  return getReadinessRules(tenantId);
}

async function publishBaseline(
  tx: Prisma.TransactionClient,
  tenantId: string,
  baseline: ReadinessRuleSet,
  actor: { id: string; name: string; role: string },
): Promise<void> {
  const published = await tx.readinessRuleSet.create({
    data: {
      tenantId,
      status: 'PUBLISHED',
      version: baseline.version,
      criteria: baseline.criteria as unknown as Prisma.InputJsonValue,
      blockers: baseline.blockers as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
      updatedBy: actor.id,
    },
  });
  await recordChainedReadinessAudit(tx, {
    tenantId,
    action: 'published',
    entityType: 'ReadinessRuleSet',
    entityId: published.id,
    actor: { id: actor.id, name: actor.name, role: actor.role },
    after: {
      version: published.version,
      criteria: published.criteria,
      blockers: published.blockers,
    },
  });
  await requestFleetRecalc(tx, tenantId, published.version);
}

/**
 * Новые правила без пересчёта — правила, которых никто не видит.
 *
 * Снимок готовности неизменяем: он хранит вердикт, посчитанный по правилам,
 * действовавшим в тот момент. Публикация сама по себе ни одного снимка не
 * трогает, поэтому владелец включал правило, открывал парк — и не видел
 * никакой разницы до суточного прогона планировщика или до случайного события
 * по конкретной машине. Выглядело как «настройка не работает».
 *
 * Заказ идёт той же очередью, что и суточный пересчёт: ключ дедупликации —
 * версия набора, так что повторная публикация той же версии второй раз ничего
 * не закажет, а каждая новая — закажет по одному пересчёту на машину.
 */
async function requestFleetRecalc(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ruleSetVersion: string,
): Promise<void> {
  const now = new Date();
  const fleet = await tx.equipment.findMany({
    where: { tenantId, isActive: true },
    select: { id: true },
  });
  for (const equipment of fleet) {
    await requestReadinessSnapshot(tx as unknown as typeof db, {
      tenantId,
      equipmentId: equipment.id,
      aggregateId: equipment.id,
      aggregateType: 'Equipment',
      triggerType: 'RULES_PUBLISHED',
      triggerId: ruleSetVersion,
      occurredAt: now,
    });
  }
}

export async function publishReadinessRules(
  tenantId: string,
  actor: { id: string; name: string; role: string },
): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('publishReadinessRules: tenantId is required');

  await db.$transaction(async (tx) => {
    // Тот же ресурс, что и у сохранения черновика: публикация и сохранение,
    // идущие одновременно, обязаны сериализоваться. Иначе сохранение,
    // начатое до публикации, правит своим `update` по id уже опубликованный
    // набор — действующие правила меняются без публикации и без черновика
    // (F-R38-10). Замок транзакционный, снимается сам при коммите или откате.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`readiness-draft:rules:${tenantId}`}))`;

    const state = await getReadinessRules(tenantId, tx);
    const draftRow = await tx.readinessRuleSet.findFirst({
      where: { tenantId, status: 'DRAFT' },
    });
    if (!draftRow) {
      // Публиковать нечего только если действующая версия уже лежит в базе.
      // У нового тенанта её нет: getReadinessRules отдаёт значения по умолчанию
      // из кода, экран рисует «Опубликована», а вычислитель готовности при этом
      // считает правила неопубликованными и блокирует расчёт. Первое нажатие
      // «Опубликовать» должно закрепить эти значения в базе, а не молча ничего
      // не сделать.
      const publishedRow = await tx.readinessRuleSet.findFirst({
        where: { tenantId, status: 'PUBLISHED' },
        select: { id: true },
      });
      if (publishedRow) return;
      await publishBaseline(tx, tenantId, state.published, actor);
      return;
    }

    await tx.readinessRuleSet.updateMany({
      where: { tenantId, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    });
    const published = await tx.readinessRuleSet.update({
      where: { id: draftRow.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        updatedBy: actor.id,
      },
    });
    await recordChainedReadinessAudit(tx, {
      tenantId,
      action: 'published',
      entityType: 'ReadinessRuleSet',
      entityId: published.id,
      actor: { id: actor.id, name: actor.name, role: actor.role },
      before: ruleSetPayload(state.published),
      after: {
        version: published.version,
        criteria: published.criteria,
        blockers: published.blockers,
      },
    });
    await requestFleetRecalc(tx, tenantId, published.version);
  });
  return getReadinessRules(tenantId);
}
