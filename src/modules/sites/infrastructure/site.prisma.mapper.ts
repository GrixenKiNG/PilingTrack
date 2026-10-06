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
    latitude: state.latitude ?? null,
    longitude: state.longitude ?? null,
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
    latitude: prismaSite.latitude ?? null,
    longitude: prismaSite.longitude ?? null,
    completionDate: prismaSite.completionDate,
    isActive: prismaSite.isActive,
    createdAt: prismaSite.createdAt.toISOString(),
    updatedAt: prismaSite.updatedAt.toISOString(),
  };
}

// Организацию кладём в строку outbox явно: потребитель открывает контекст
// ровно этим значением (outbox-publisher.ts), и при пустом tenantId строгий
// RLS отдаёт обработчику ноль строк. События SiteActivated/SiteDeactivated
// тенанта не несут, поэтому берём его из состояния агрегата, а не из события
// (см. вызов в site.repository.ts). `undefined` — у объекта нет организации,
// колонка OutboxEvent.tenantId nullable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
export function toOutboxData(event: any, tenantId?: string) {
  return {
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: 'Site',
    payload: event,
    tenantId,
  };
}
