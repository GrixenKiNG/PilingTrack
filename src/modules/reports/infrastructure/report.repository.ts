/**
 * Report Repository
 *
 * Infrastructure-layer repository for persisting ReportAggregate.
 * SINGLE write path — no duplicate persistence elsewhere.
 *
 * Knows about Prisma; domain layer does not.
 */

import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { reconcileReportEntries } from './reconcile-report-entries';
import { ServiceError } from '@/lib/service-error';
import { ReportAggregate } from '../domain';
import { fromPrismaToState } from './report.prisma.mapper';

/**
 * Hooks that run inside the save transaction. Used by callers (e.g. audit,
 * analytics) that MUST persist atomically with the aggregate — if the tx
 * rolls back, these side-effects are rolled back too.
 */
export interface SaveHooks {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
  onBeforeCommit?: (tx: any) => Promise<void>;
  /**
   * Optimistic-concurrency check. When set, the save reads the stored row's
   * version INSIDE the transaction and throws 409 if it differs — catching
   * the case where two clients both loaded the same version and raced to
   * save (last-write-wins would silently drop one edit). Undefined → skip.
   */
  expectedVersion?: number;
}

/**
 * Map domain events to outbox database records.
 * Called INSIDE the transaction to ensure atomicity.
 */
function mapEventsToOutboxData(
  events: ReadonlyArray<{ type: string; aggregateId: string; aggregateType: string; data?: unknown }>,
  reportId: string,
  tenantId: string | null
): Array<{
  type: string;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  published: boolean;
  attempts: number;
  tenantId: string | null;
}> {
  return events.map((event) => ({
    type: event.type,
    aggregateId: reportId,
    aggregateType: event.aggregateType || 'Report',
    payload: event.data || {},
    published: false,
    attempts: 0,
    // Тенант писался только readiness-издателями, а события отчётов ложились
    // с пустым tenantId: строка outbox переставала принадлежать тенанту и
    // выпадала из-под RLS-политики. Берём его из состояния отчёта — там он
    // уже проверен на входе команды.
    tenantId,
  }));
}

export interface ReportRepository {
  save(aggregate: ReportAggregate, hooks?: SaveHooks): Promise<void>;
  findById(reportId: string): Promise<ReportAggregate | null>;
  findByUserIdAndDate(
    userId: string,
    siteId: string,
    date: string
  ): Promise<ReportAggregate | null>;
}

export class PrismaReportRepository implements ReportRepository {
  /**
   * Save aggregate: upsert report + child entities, outbox events, and any
   * caller-provided onBeforeCommit hooks — all inside a single transaction.
   *
   * The outbox is written synchronously in-tx (transactional outbox
   * pattern). The previous implementation ALSO pushed events to an in-memory
   * asyncOutbox queue after commit, which duplicated every event and caused
   * exactly-once consumers to receive them twice. That dual-write has been
   * removed.
   */
  async save(aggregate: ReportAggregate, hooks?: SaveHooks): Promise<void> {
    const state = aggregate.getState();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
    await db.$transaction(async (tx: any) => {
      const existing = await tx.report.findUnique({
        where: { reportId: state.reportId },
        select: { id: true, version: true, tenantId: true, shiftId: true },
      });

      // Optimistic-concurrency guard (race-free: the version is read in the
      // same tx that writes). If the caller passed the version it edited and
      // the stored row has moved on, abort so the loser can reload instead of
      // silently overwriting the winner's edit.
      if (
        hooks?.expectedVersion !== undefined &&
        existing &&
        existing.version !== hooks.expectedVersion
      ) {
        throw new ServiceError(
          'Отчёт был изменён другим пользователем. Обновите страницу и сохраните заново.',
          409
        );
      }

      if (existing) {
        // === UPDATE PATH ===

        // Claim the version atomically before reading children. Concurrent saves
        // cannot both pass a read-then-write check at READ COMMITTED.
        const claimed = await tx.report.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            version: { increment: 1 },
            status: state.status,
            shiftType: state.shiftType,
            shiftStart: state.shiftStart,
            shiftEnd: state.shiftEnd,
            equipmentId: state.equipmentId,
            lastEditedById: state.lastEditedById,
            lastEditedByName: state.lastEditedByName,
            lastEditedByRole: state.lastEditedByRole,
          },
        });
        if (claimed.count !== 1) {
          throw new ServiceError('Отчёт был изменён другим пользователем. Обновите страницу.', 409);
        }
        const provenance = { tenantId: existing.tenantId, shiftId: existing.shiftId };
        const groups = [
          { model: tx.pileWork, entries: state.piles, fields: ['pileGradeId', 'count', 'picketId'], group: ['pileGradeId', 'picketId'], include: { passport: true } },
          { model: tx.leaderDrilling, entries: state.drillings, fields: ['typeId', 'count', 'metersPerUnit', 'meters', 'picketId'], group: ['typeId', 'picketId'] },
          { model: tx.reportDowntime, entries: state.downtimes, fields: ['reasonId', 'duration', 'comment'], group: ['reasonId'] },
        ];
        for (const group of groups) {
          const stored = await group.model.findMany({
            where: { reportId: existing.id },
            ...(group.include ? { include: group.include } : {}),
            orderBy: { id: 'asc' },
          });
          const plan = reconcileReportEntries(stored, group.entries, group.fields, group.group);
          if (plan.removeIds.length) {
            await group.model.deleteMany({ where: { reportId: existing.id, id: { in: plan.removeIds } } });
          }
          for (const row of plan.rows) {
            if (row.id) {
              await group.model.update({ where: { id: row.id }, data: { ...row.data, ...provenance } });
            } else {
              await group.model.create({ data: { ...row.data, ...provenance, reportId: existing.id } });
            }
          }
        }
      } else {
        // === CREATE PATH ===
        await tx.report.create({
          data: {
            reportId: state.reportId,
            userId: state.userId,
            siteId: state.siteId,
            tenantId: state.tenantId,
            crewId: state.crewId,
            shiftId: state.shiftId,
            date: state.date,
            shiftType: state.shiftType,
            shiftStart: state.shiftStart,
            shiftEnd: state.shiftEnd,
            equipmentId: state.equipmentId,
            status: state.status,
            lastEditedById: state.lastEditedById,
            lastEditedByName: state.lastEditedByName,
            lastEditedByRole: state.lastEditedByRole,
            piles: {
              create: state.piles.map((pile) => ({
                tenantId: state.tenantId,
                shiftId: state.shiftId,
                picketId: pile.picketId || null,
                pileGradeId: pile.pileGradeId,
                count: pile.count,
              })),
            },
            drillings: {
              create: state.drillings.map((drilling) => ({
                tenantId: state.tenantId,
                shiftId: state.shiftId,
                picketId: drilling.picketId || null,
                typeId: drilling.typeId,
                count: drilling.count,
                metersPerUnit: drilling.metersPerUnit,
                meters: drilling.meters,
              })),
            },
            downtimes: {
              create: state.downtimes.map((downtime) => ({
                tenantId: state.tenantId,
                shiftId: state.shiftId,
                reasonId: downtime.reasonId,
                duration: downtime.duration,
                comment: downtime.comment || null,
              })),
            },
          },
        });
      }

      // === TRANSACTIONAL OUTBOX ===
      // Write outbox events IN THE SAME TRANSACTION as report data.
      // This guarantees atomicity: either both report and events are persisted,
      // or neither is — preventing data/event inconsistency.
      const pendingEvents = aggregate.getPendingEvents();
      if (pendingEvents.length > 0) {
        const outboxRecords = mapEventsToOutboxData(pendingEvents, state.reportId, state.tenantId ?? null);
        await tx.outboxEvent.createMany({ data: outboxRecords });
      }

      // === REPORT VERSION SNAPSHOT ===
      // Create an immutable snapshot of the full report state.
      // Used for audit, rollback, and conflict resolution.
      // Reuse the version already read above (same tx) — no extra round-trip.
      const newVersion = (existing?.version || 0) + 1;

      await tx.reportVersion.create({
        data: {
          reportId: state.reportId,
          version: newVersion,
          data: {
            ...state,
            version: newVersion,
            piles: state.piles,
            drillings: state.drillings,
            downtimes: state.downtimes,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
          } as any,
          actorId: state.lastEditedById || state.userId,
        },
      });

      // Caller-provided in-tx side effects (e.g. audit trail). Runs LAST so
      // it can observe the fully-persisted state, but still inside the tx
      // — if the hook throws, report + outbox + version are all rolled back.
      if (hooks?.onBeforeCommit) {
        await hooks.onBeforeCommit(tx);
      }
    }, DEFAULT_TX_OPTIONS);

    // Clear pending events after successful persistence. Downstream
    // consumers pick up events via the outbox table, which was written in
    // the same tx above.
    aggregate.clearPendingEvents();
  }

  /**
   * Find aggregate by reportId and reconstitute it.
   */
  async findById(reportId: string): Promise<ReportAggregate | null> {
    const prismaReport = await db.report.findUnique({
      where: { reportId },
      include: {
        piles: true,
        drillings: true,
        downtimes: true,
      },
    });

    if (!prismaReport) return null;

    const state = fromPrismaToState(prismaReport);
    return ReportAggregate.reconstitute(state);
  }

  /**
   * Find aggregate by user + site + date and reconstitute it.
   */
  async findByUserIdAndDate(
    userId: string,
    siteId: string,
    date: string
  ): Promise<ReportAggregate | null> {
    const prismaReport = await db.report.findFirst({
      where: { userId, siteId, date, shiftId: null },
      orderBy: { createdAt: 'desc' },
      include: {
        piles: true,
        drillings: true,
        downtimes: true,
      },
    });

    if (!prismaReport) return null;

    const state = fromPrismaToState(prismaReport);
    return ReportAggregate.reconstitute(state);
  }
}

// Singleton instance
let _instance: PrismaReportRepository | null = null;

export function getReportRepository(): ReportRepository {
  if (!_instance) {
    _instance = new PrismaReportRepository();
  }
  return _instance;
}
