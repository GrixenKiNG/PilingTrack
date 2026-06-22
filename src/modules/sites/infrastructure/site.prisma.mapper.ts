/**
 * Site Prisma Mapper
 */

import { SiteAggregate, SiteInfo } from '../domain';

export function toPrismaData(aggregate: SiteAggregate) {
  const state = aggregate.getState();
  return {
    id: state.id,
    name: state.name,
    tenantId: state.tenantId,
    status: state.status,
    plannedPiles: state.plannedPiles,
    plannedDrilling: state.plannedDrilling,
    completionDate: state.completionDate,
    isActive: state.isActive,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma row shape boundary in a mapper
export function fromPrismaToState(prismaSite: any): SiteInfo {
  return {
    id: prismaSite.id,
    name: prismaSite.name,
    tenantId: prismaSite.tenantId,
    status: prismaSite.status,
    plannedPiles: prismaSite.plannedPiles,
    plannedDrilling: prismaSite.plannedDrilling,
    completionDate: prismaSite.completionDate,
    isActive: prismaSite.isActive,
    createdAt: prismaSite.createdAt.toISOString(),
    updatedAt: prismaSite.updatedAt.toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
export function toOutboxData(event: any) {
  return {
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: 'Site',
    payload: event,
  };
}
