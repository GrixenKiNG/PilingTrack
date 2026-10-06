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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma row shape boundary in a mapper
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

// Организацию кладём в строку outbox явно: потребитель открывает контекст
// ровно этим значением (outbox-publisher.ts), и при пустом tenantId строгий
// RLS отдаёт обработчику ноль строк. У бригады своей колонки tenantId нет —
// организация приходит от объекта (site) через контекст команды, см. вызов в
// crew.repository.ts. `undefined` — контекст пуст, колонка nullable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
export function toOutboxData(event: any, tenantId?: string) {
  return {
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: 'Crew',
    payload: event,
    tenantId,
  };
}
