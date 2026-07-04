import { db } from '@/lib/db';
import { EquipmentAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './equipment.prisma.mapper';

export interface EquipmentRepository {
  save(agg: EquipmentAggregate): Promise<void>;
  findById(id: string, tenantId: string): Promise<EquipmentAggregate | null>;
}

export class PrismaEquipmentRepository implements EquipmentRepository {
  async save(agg: EquipmentAggregate): Promise<void> {
    const s = agg.getState();
    const pd = toPrismaData(agg);
    const evts = agg.getPendingEvents();
    // Transactional outbox (audit finding #3): the upsert and its domain
    // events must commit or fail together. The previous version wrote them
    // as two separate statements — a standalone `equipment.upsert` already
    // committed by the time the outbox `Promise.all` ran, so a failing
    // outbox write silently lost the domain event while the equipment
    // change stuck. site.repository.ts / report.repository.ts (the
    // DDD-migration reference) already use this same pattern.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
    await db.$transaction(async (tx: any) => {
      await tx.equipment.upsert({
        where: { id: s.id },
        create: pd,
        update: { name: pd.name, model: pd.model, qty: pd.qty, description: pd.description, isActive: pd.isActive },
      });
      if (evts.length > 0) {
        await Promise.all(evts.map(e => tx.outboxEvent.create({ data: toOutboxData(e) })));
      }
    });
    agg.clearPendingEvents();
  }

  async findById(id: string, tenantId: string): Promise<EquipmentAggregate | null> {
    const p = await db.equipment.findUnique({ where: { id, tenantId } });
    if (!p) return null;
    return EquipmentAggregate.reconstitute(fromPrismaToState(p));
  }
}

let _i: PrismaEquipmentRepository | null = null;
export function getEquipmentRepository(): EquipmentRepository {
  if (!_i) _i = new PrismaEquipmentRepository();
  return _i;
}
