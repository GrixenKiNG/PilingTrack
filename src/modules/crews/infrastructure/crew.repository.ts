/**
 * Crew Repository
 */

import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
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

/**
 * updatedAt строки на момент чтения. Агрегат сам двигает state.updatedAt в
 * «сейчас» при любой правке, поэтому ожидаемую версию берём не из состояния, а
 * запоминаем при загрузке. Нет записи — бригада новая и пишется через create.
 */
const loadedVersions = new WeakMap<CrewAggregate, Date>();

export class PrismaCrewRepository implements CrewRepository {
  async save(aggregate: CrewAggregate, hooks?: CrewSaveHooks): Promise<void> {
    const state = aggregate.getState();
    const persistenceData = toPrismaData(aggregate);
    const pendingEvents = aggregate.getPendingEvents();
    // Transactional outbox: crew data + outbox events + caller hooks in one tx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
    await db.$transaction(async (tx: any) => {
      const loadedAt = loadedVersions.get(aggregate);
      if (loadedAt) {
        // Загруженную бригаду пишем условно по updatedAt, прочитанному в
        // findById. Безусловный upsert отдавал бы победу последнему писателю:
        // устаревший запрос затирал переименование, возвращал расформированную
        // бригаду и воскрешал удалённую. Условие делает потерю обновления
        // конфликтом, который видит вызывающий.
        const claimed = await tx.crew.updateMany({
          where: { id: state.id, updatedAt: loadedAt },
          data: {
            name: persistenceData.name,
            operatorId: persistenceData.operatorId,
            equipmentId: persistenceData.equipmentId,
            siteId: persistenceData.siteId,
            isActive: persistenceData.isActive,
          },
        });
        if (claimed.count !== 1) {
          throw new ServiceError('Бригада изменена или удалена другим запросом. Обновите список.', 409);
        }
      } else {
        await tx.crew.create({ data: persistenceData });
      }

      if (pendingEvents.length > 0) {
        // Platform ADMIN may have another tenant: the crew belongs to its Site.
        const site = await tx.site.findUnique({ where: { id: state.siteId }, select: { tenantId: true } });
        if (!site?.tenantId) throw new Error("Crew outbox requires Site.tenantId");
        const tenantId = site.tenantId;
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
    const aggregate = CrewAggregate.reconstitute(fromPrismaToState(prismaCrew));
    loadedVersions.set(aggregate, prismaCrew.updatedAt);
    return aggregate;
  }
}

let _instance: PrismaCrewRepository | null = null;
export function getCrewRepository(): CrewRepository {
  if (!_instance) _instance = new PrismaCrewRepository();
  return _instance;
}
