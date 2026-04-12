/**
 * Crew Mapper
 */

import { CrewAggregate, CrewInfo } from '../domain';

export function toPrismaData(aggregate: CrewAggregate) {
  const state = aggregate.getState();
  return {
    id: state.id,
    name: state.name,
    operatorId: state.operatorId,
    equipmentId: state.equipmentId,
    siteId: state.siteId,
    isActive: state.isActive,
  };
}

export function fromPrismaToState(prismaCrew: any): CrewInfo {
  return {
    id: prismaCrew.id,
    name: prismaCrew.name,
    operatorId: prismaCrew.operatorId,
    equipmentId: prismaCrew.equipmentId,
    siteId: prismaCrew.siteId,
    isActive: prismaCrew.isActive,
    createdAt: prismaCrew.createdAt.toISOString(),
    updatedAt: prismaCrew.updatedAt.toISOString(),
  };
}

export function toOutboxData(event: any) {
  return {
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: 'Crew',
    payload: event,
  };
}
