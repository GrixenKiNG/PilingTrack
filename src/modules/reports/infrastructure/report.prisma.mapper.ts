/**
 * Report Prisma Mapper
 *
 * Translates between domain ReportAggregate state and Prisma persistence models.
 * Infrastructure concern — only this file knows about Prisma shapes.
 */

import { ReportAggregate, PileWorkEntry, DrillingEntry, DowntimeEntry } from '../domain';

/**
 * Map aggregate state to Prisma create/update data.
 */
export function toPrismaCreateData(aggregate: ReportAggregate) {
  const state = aggregate.getState();

  return {
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
    version: state.version,
    lastEditedById: state.lastEditedById,
    lastEditedByName: state.lastEditedByName,
    lastEditedByRole: state.lastEditedByRole,
    piles: {
      create: state.piles.map((pile: PileWorkEntry) => ({
        picketId: pile.picketId || null,
        pileGradeId: pile.pileGradeId,
        count: pile.count,
      })),
    },
    drillings: {
      create: state.drillings.map((drilling: DrillingEntry) => ({
        picketId: drilling.picketId || null,
        typeId: drilling.typeId,
        count: drilling.count,
        metersPerUnit: drilling.metersPerUnit,
        meters: drilling.meters,
      })),
    },
    downtimes: {
      create: state.downtimes.map((downtime: DowntimeEntry) => ({
        reasonId: downtime.reasonId,
        duration: downtime.duration,
        comment: downtime.comment || null,
      })),
    },
  };
}

/**
 * Map Prisma model to aggregate state for reconstitution.
 */
export function fromPrismaToState(prismaReport: any): Parameters<typeof ReportAggregate.reconstitute>[0] {
  return {
    id: prismaReport.id,
    reportId: prismaReport.reportId,
    userId: prismaReport.userId,
    siteId: prismaReport.siteId,
    tenantId: prismaReport.tenantId,
    date: prismaReport.date,
    shiftType: prismaReport.shiftType,
    shiftStart: prismaReport.shiftStart,
    shiftEnd: prismaReport.shiftEnd,
    equipmentId: prismaReport.equipmentId,
    status: prismaReport.status,
    piles: prismaReport.piles || [],
    drillings: prismaReport.drillings || [],
    downtimes: prismaReport.downtimes || [],
    version: prismaReport.version || 0,
    createdAt: prismaReport.createdAt.toISOString(),
    updatedAt: prismaReport.updatedAt.toISOString(),
    lastEditedById: prismaReport.lastEditedById,
    lastEditedByName: prismaReport.lastEditedByName,
    lastEditedByRole: prismaReport.lastEditedByRole,
  };
}

/**
 * Map domain event to outbox record data.
 */
export function toOutboxData(event: any) {
  return {
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: 'Report',
    payload: event,
  };
}
