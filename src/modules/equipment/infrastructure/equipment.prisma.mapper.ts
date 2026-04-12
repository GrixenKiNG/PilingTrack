import { EquipmentAggregate, EquipmentInfo } from '../domain';
export function toPrismaData(agg: EquipmentAggregate) { const s = agg.getState(); return { id: s.id, name: s.name, model: s.model, qty: s.qty, description: s.description, isActive: s.isActive }; }
export function fromPrismaToState(p: any): EquipmentInfo { return { id: p.id, name: p.name, model: p.model, qty: p.qty, description: p.description, isActive: p.isActive, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }; }
export function toOutboxData(e: any) { return { type: e.type, aggregateId: e.aggregateId, aggregateType: 'Equipment', payload: e }; }
