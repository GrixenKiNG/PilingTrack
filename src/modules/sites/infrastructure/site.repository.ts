/**
 * Site Repository
 */

import { db } from '@/lib/db';
import { SiteAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './site.prisma.mapper';

export interface SiteRepository {
  save(aggregate: SiteAggregate): Promise<void>;
  findById(id: string): Promise<SiteAggregate | null>;
}

export class PrismaSiteRepository implements SiteRepository {
  async save(aggregate: SiteAggregate): Promise<void> {
    const state = aggregate.getState();
    const persistenceData = toPrismaData(aggregate);
    const pendingEvents = aggregate.getPendingEvents();

    await db.site.upsert({
      where: { id: state.id },
      create: persistenceData,
      update: {
        name: persistenceData.name,
        status: persistenceData.status,
        plannedPiles: persistenceData.plannedPiles,
        plannedDrilling: persistenceData.plannedDrilling,
        completionDate: persistenceData.completionDate,
        isActive: persistenceData.isActive,
      },
    });

    // Save events to outbox
    if (pendingEvents.length > 0) {
      await Promise.all(
        pendingEvents.map((event) =>
          db.outboxEvent.create({
            data: toOutboxData(event),
          })
        )
      );
    }

    aggregate.clearPendingEvents();
  }

  async findById(id: string): Promise<SiteAggregate | null> {
    const prismaSite = await db.site.findUnique({
      where: { id },
    });

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
