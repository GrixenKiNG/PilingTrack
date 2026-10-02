import { Prisma } from '@/generated/postgres-client';
import { EquipmentAggregate, EquipmentInfo, EquipmentDomainEvent } from '../domain';

export function toPrismaData(agg: EquipmentAggregate) {
  const s = agg.getState();
  return { id: s.id, name: s.name, model: s.model, qty: s.qty, description: s.description, isActive: s.isActive, tenantId: s.tenantId };
}

export function fromPrismaToState(p: { id: string; name: string; model: string; qty: number; description: string; isActive: boolean; tenantId: string; createdAt: Date; updatedAt: Date }): EquipmentInfo {
  return { id: p.id, name: p.name, model: p.model, qty: p.qty, description: p.description, isActive: p.isActive, tenantId: p.tenantId, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

// Организацию кладём в строку outbox явно: потребитель открывает контекст
// ровно этим значением (outbox-publisher.ts), и при пустом tenantId строгий
// RLS отдаёт обработчику ноль строк. Событие тенанта не несёт — берём его из
// состояния агрегата (см. вызов в equipment.repository.ts).
export function toOutboxData(e: EquipmentDomainEvent, tenantId: string) {
  return { type: e.type, aggregateId: e.aggregateId, aggregateType: 'Equipment', payload: e as unknown as Prisma.JsonObject, tenantId };
}
