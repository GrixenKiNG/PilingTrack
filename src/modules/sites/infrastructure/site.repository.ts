/**
 * Site Repository
 */

import { db } from '@/lib/db';
import { SiteAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './site.prisma.mapper';

export interface SiteRepository {
  save(aggregate: SiteAggregate): Promise<void>;
  findById(id: string, tenantId: string): Promise<SiteAggregate | null>;
}

export class PrismaSiteRepository implements SiteRepository {
  async save(aggregate: SiteAggregate): Promise<void> {
    const state = aggregate.getState();
    const persistenceData = toPrismaData(aggregate);
    const pendingEvents = aggregate.getPendingEvents();

    await db.$transaction(async (tx) => {
      await tx.site.upsert({
        where: { id: state.id }, create: persistenceData,
        update: { name: persistenceData.name, status: persistenceData.status,
          plannedPiles: persistenceData.plannedPiles, plannedDrilling: persistenceData.plannedDrilling,
          completionDate: persistenceData.completionDate, isActive: persistenceData.isActive },
      });
      if (pendingEvents.length > 0) {
        await tx.outboxEvent.createMany({ data: pendingEvents.map(toOutboxData) });
      }
    });

    aggregate.clearPendingEvents();
  }

  async findById(id: string, tenantId: string): Promise<SiteAggregate | null> {
    const prismaSite = await db.site.findFirst({ where: { id, tenantId } });

    if (!prismaSite) return null;

    const state = fromPrismaToState(prismaSite);
    return SiteAggregate.reconstitute(state);
  }
}

let _instance: PrismaSiteRepository | null = null;

export function getSiteRepository(): SiteRepository {
  if (!_instance) {
    _instance = new PrismaSiteRepository();
  }
  return _instance;
}
