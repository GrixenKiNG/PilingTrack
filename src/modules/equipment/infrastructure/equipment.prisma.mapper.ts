import { EquipmentAggregate, EquipmentInfo } from '../domain';

export function toPrismaData(agg: EquipmentAggregate) {
  const s = agg.getState();
  return { id: s.id, name: s.name, model: s.model, qty: s.qty, description: s.description, isActive: s.isActive, tenantId: s.tenantId };
}

export function fromPrismaToState(p: { id: string; name: string; model: string; qty: number; description: string; isActive: boolean; tenantId: string; createdAt: Date; updatedAt: Date }): EquipmentInfo {
  return { id: p.id, name: p.name, model: p.model, qty: p.qty, description: p.description, isActive: p.isActive, tenantId: p.tenantId, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

export function toOutboxData(e: { type: string; aggregateId: string; [key: string]: unknown }) {
  return { type: e.type, aggregateId: e.aggregateId, aggregateType: 'Equipment', payload: e };
}
