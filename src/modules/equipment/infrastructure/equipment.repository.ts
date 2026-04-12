import { db } from '@/lib/db';
import { EquipmentAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './equipment.prisma.mapper';
export interface EquipmentRepository { save(agg: EquipmentAggregate): Promise<void>; findById(id: string): Promise<EquipmentAggregate | null>; }
export class PrismaEquipmentRepository implements EquipmentRepository {
  async save(agg: EquipmentAggregate): Promise<void> {
    const s = agg.getState(); const pd = toPrismaData(agg); const evts = agg.getPendingEvents();
    await db.equipment.upsert({ where: { id: s.id }, create: pd, update: { name: pd.name, model: pd.model, qty: pd.qty, description: pd.description, isActive: pd.isActive } });
    if (evts.length > 0) await Promise.all(evts.map(e => db.outboxEvent.create({ data: toOutboxData(e) })));
    agg.clearPendingEvents();
  }
  async findById(id: string): Promise<EquipmentAggregate | null> {
    const p = await db.equipment.findUnique({ where: { id } });
    if (!p) return null; return EquipmentAggregate.reconstitute(fromPrismaToState(p));
  }
}
let _i: PrismaEquipmentRepository | null = null;
export function getEquipmentRepository(): EquipmentRepository { if (!_i) _i = new PrismaEquipmentRepository(); return _i; }
