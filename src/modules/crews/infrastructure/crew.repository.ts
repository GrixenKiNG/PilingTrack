/**
 * Crew Repository
 */

import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { CrewAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './crew.prisma.mapper';

export interface CrewRepository {
  save(aggregate: CrewAggregate): Promise<void>;
  findById(id: string): Promise<CrewAggregate | null>;
}

export class PrismaCrewRepository implements CrewRepository {
  async save(aggregate: CrewAggregate): Promise<void> {
    const state = aggregate.getState();
    const persistenceData = toPrismaData(aggregate);
    const pendingEvents = aggregate.getPendingEvents();

    // Transactional outbox: crew data + outbox events in one transaction
    await db.$transaction(async (tx: any) => {
      await tx.crew.upsert({
        where: { id: state.id },
        create: persistenceData,
        update: {
          name: persistenceData.name,
          operatorId: persistenceData.operatorId,
          equipmentId: persistenceData.equipmentId,
          siteId: persistenceData.siteId,
          isActive: persistenceData.isActive,
        },
      });

      if (pendingEvents.length > 0) {
        const outboxRecords = pendingEvents.map((event) => {
          const data = toOutboxData(event);
          return {
            type: data.type,
            aggregateId: data.aggregateId,
            aggregateType: data.aggregateType,
            payload: data.payload as any,
          };
        });
        await tx.outboxEvent.createMany({ data: outboxRecords });
      }
    }, DEFAULT_TX_OPTIONS);

    aggregate.clearPendingEvents();
  }

  async findById(id: string): Promise<CrewAggregate | null> {
    const prismaCrew = await db.crew.findUnique({ where: { id } });
    if (!prismaCrew) return null;
    return CrewAggregate.reconstitute(fromPrismaToState(prismaCrew));
  }
}

let _instance: PrismaCrewRepository | null = null;
export function getCrewRepository(): CrewRepository {
  if (!_instance) _instance = new PrismaCrewRepository();
  return _instance;
}
