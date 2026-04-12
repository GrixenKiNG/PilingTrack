/**
 * Report Repository
 *
 * Infrastructure-layer repository for persisting ReportAggregate.
 * SINGLE write path — no duplicate persistence elsewhere.
 *
 * Knows about Prisma; domain layer does not.
 */

import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { ReportAggregate } from '../domain';
import { fromPrismaToState, toOutboxData } from './report.prisma.mapper';

/**
 * Hooks that run inside the save transaction. Used by callers (e.g. audit,
 * analytics) that MUST persist atomically with the aggregate — if the tx
 * rolls back, these side-effects are rolled back too.
 */
export interface SaveHooks {
  onBeforeCommit?: (tx: any) => Promise<void>;
}

/**
 * Map domain events to outbox database records.
 * Called INSIDE the transaction to ensure atomicity.
 */
function mapEventsToOutboxData(
  events: ReadonlyArray<{ type: string; aggregateId: string; aggregateType: string; data?: unknown }>,
  reportId: string
): Array<{
  type: string;
  aggregateId: string;
  aggregateType: string;
  payload: unknown;
  published: boolean;
  attempts: number;
}> {
  return events.map((event) => ({
    type: event.type,
    aggregateId: reportId,
    aggregateType: event.aggregateType || 'Report',
    payload: event.data || {},
    published: false,
    attempts: 0,
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
    const pendingEvents = aggregate.getPendingEvents();
    const isPostgres = process.env.DATABASE_PROVIDER === 'postgres';

    await db.$transaction(async (tx: any) => {
      // Check if report exists
      const existing = await tx.report.findUnique({
        where: { reportId: state.reportId },
        select: { id: true },
      });

      if (existing) {
        // === UPDATE PATH ===

        // Delete old child records
        await tx.reportDowntime.deleteMany({ where: { reportId: existing.id } });
        await tx.pileWork.deleteMany({ where: { reportId: existing.id } });
        await tx.leaderDrilling.deleteMany({ where: { reportId: existing.id } });

        // Update parent
        await tx.report.update({
          where: { reportId: state.reportId },
          data: {
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

        // Batch insert children
        if (state.piles.length > 0) {
          await tx.pileWork.createMany({
            data: state.piles.map((p) => ({
              reportId: existing.id,
              pileGradeId: p.pileGradeId,
              count: p.count,
              picketId: p.picketId || null,
            })),
          });
        }

        if (state.drillings.length > 0) {
          await tx.leaderDrilling.createMany({
            data: state.drillings.map((d) => ({
              reportId: existing.id,
              typeId: d.typeId,
              count: d.count,
              metersPerUnit: d.metersPerUnit,
              meters: d.meters,
              picketId: d.picketId || null,
            })),
          });
        }

        if (state.downtimes.length > 0) {
          await tx.reportDowntime.createMany({
            data: state.downtimes.map((d) => ({
              reportId: existing.id,
              reasonId: d.reasonId,
              duration: d.duration,
              comment: d.comment || null,
            })),
          });
        }
      } else {
        // === CREATE PATH ===
        await tx.report.create({
          data: {
            reportId: state.reportId,
            userId: state.userId,
            siteId: state.siteId,
            tenantId: state.tenantId,
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
                picketId: pile.picketId || null,
                pileGradeId: pile.pileGradeId,
                count: pile.count,
              })),
            },
            drillings: {
              create: state.drillings.map((drilling) => ({
                picketId: drilling.picketId || null,
                typeId: drilling.typeId,
                count: drilling.count,
                metersPerUnit: drilling.metersPerUnit,
                meters: drilling.meters,
              })),
            },
            downtimes: {
              create: state.downtimes.map((downtime) => ({
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
        const outboxRecords = mapEventsToOutboxData(pendingEvents, state.reportId);
        await tx.outboxEvent.createMany({ data: outboxRecords });
      }

      // === REPORT VERSION SNAPSHOT ===
      // Create an immutable snapshot of the full report state.
      // Used for audit, rollback, and conflict resolution.
      const existingVersion = existing
        ? await tx.report.findUnique({ where: { reportId: state.reportId }, select: { version: true } })
        : null;
      const newVersion = (existingVersion?.version || 0) + 1;

      // Update report version (if existing)
      if (existing) {
        await tx.report.update({
          where: { reportId: state.reportId },
          data: { version: newVersion },
        });
      }

      await tx.reportVersion.create({
        data: {
          reportId: state.reportId,
          version: newVersion,
          data: {
            ...state,
            piles: state.piles,
            drillings: state.drillings,
            downtimes: state.downtimes,
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
      where: { userId, siteId, date },
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
