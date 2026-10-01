/**
 * Crew Repository
 */

import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { getRequestTenantId } from '@/core/security/tenant-context';
import { CrewAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './crew.prisma.mapper';

/**
 * Hooks that run inside the save transaction. Callers that MUST persist
 * atomically with the crew (e.g. crew assistants) pass onBeforeCommit — if the
 * tx rolls back, those side-effects roll back too. Mirrors the report repo.
 */
export interface CrewSaveHooks {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
  onBeforeCommit?: (tx: any) => Promise<void>;
}

export interface CrewRepository {
  save(aggregate: CrewAggregate, hooks?: CrewSaveHooks): Promise<void>;
  findById(id: string): Promise<CrewAggregate | null>;
}

export class PrismaCrewRepository implements CrewRepository {
  async save(aggregate: CrewAggregate, hooks?: CrewSaveHooks): Promise<void> {
    const state = aggregate.getState();
    const persistenceData = toPrismaData(aggregate);
    const pendingEvents = aggregate.getPendingEvents();
    // У бригады нет своей колонки tenantId — её организация это организация
    // объекта (site). Здесь она уже известна: команды бригады ходят только из
    // запроса, а обёртка маршрута открывает контекст и кладёт туда тенанта
    // (F-R86-OUTBOX-TENANT). Лишний запрос за объектом не делаем.
    const tenantId = getRequestTenantId() ?? undefined;

    // Transactional outbox: crew data + outbox events + caller hooks in one tx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
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
          const data = toOutboxData(event, tenantId);
          return {
            type: data.type,
            aggregateId: data.aggregateId,
            aggregateType: data.aggregateType,
            tenantId: data.tenantId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
            payload: data.payload as any,
          };
        });
        await tx.outboxEvent.createMany({ data: outboxRecords });
      }

      // Caller-provided in-tx side effects (e.g. crew assistants). Runs LAST so
      // it observes the persisted crew, but still inside the tx — if it throws,
      // the crew row and outbox events are rolled back together.
      if (hooks?.onBeforeCommit) {
        await hooks.onBeforeCommit(tx);
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
