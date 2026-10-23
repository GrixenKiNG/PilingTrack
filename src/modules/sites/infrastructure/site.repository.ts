/**
 * Site Repository
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type { AuditClient } from '@/modules/audit';
import { SiteAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './site.prisma.mapper';

export interface SiteRepository {
  /**
   * `inSameTransaction` выполняется внутри транзакции записи: сбой в нём откатывает
   * и запись объекта (так пишется след, без которого изменение недопустимо).
   */
  save(aggregate: SiteAggregate, inSameTransaction?: (tx: AuditClient) => Promise<void>): Promise<void>;
  findById(id: string, tenantId: string): Promise<SiteAggregate | null>;
}

/**
 * updatedAt строки на момент чтения. Агрегат сам двигает state.updatedAt в
 * «сейчас» при любой правке, поэтому ожидаемую версию берём не из состояния, а
 * запоминаем при загрузке. Нет записи — объект новый и пишется через create.
 */
const loadedVersions = new WeakMap<SiteAggregate, Date>();

export class PrismaSiteRepository implements SiteRepository {
  async save(aggregate: SiteAggregate, inSameTransaction?: (tx: AuditClient) => Promise<void>): Promise<void> {
    const state = aggregate.getState();
    const persistenceData = toPrismaData(aggregate);
    const pendingEvents = aggregate.getPendingEvents();

    await db.$transaction(async (tx) => {
      const loadedAt = loadedVersions.get(aggregate);
      if (loadedAt) {
        // Загруженный объект пишем условно по updatedAt, прочитанному в
        // findById. Безусловный upsert отдавал бы победу последнему писателю:
        // устаревший запрос включал обратно деактивированный объект, затирал
        // чужую правку плана и воскрешал удалённый. Условие делает потерю
        // обновления конфликтом, который видит вызывающий.
        const claimed = await tx.site.updateMany({
          where: { id: state.id, updatedAt: loadedAt },
          data: { name: persistenceData.name, status: persistenceData.status,
            plannedPiles: persistenceData.plannedPiles, plannedDrilling: persistenceData.plannedDrilling,
            latitude: persistenceData.latitude, longitude: persistenceData.longitude,
            completionDate: persistenceData.completionDate, isActive: persistenceData.isActive },
        });
        if (claimed.count !== 1) {
          throw new ServiceError('Объект изменён или удалён. Обновите список.', 409);
        }
      } else {
        await tx.site.create({ data: persistenceData });
      }
      if (pendingEvents.length > 0) {
        await tx.outboxEvent.createMany({ data: pendingEvents.map((e) => toOutboxData(e, state.tenantId ?? undefined)) });
      }
      if (inSameTransaction) await inSameTransaction(tx);
    });

    aggregate.clearPendingEvents();
  }

  async findById(id: string, tenantId: string): Promise<SiteAggregate | null> {
    const prismaSite = await db.site.findFirst({ where: { id, tenantId } });

    if (!prismaSite) return null;

    const state = fromPrismaToState(prismaSite);
    const aggregate = SiteAggregate.reconstitute(state);
    loadedVersions.set(aggregate, prismaSite.updatedAt);
    return aggregate;
  }
}

let _instance: PrismaSiteRepository | null = null;

export function getSiteRepository(): SiteRepository {
  if (!_instance) {
    _instance = new PrismaSiteRepository();
  }
  return _instance;
}
