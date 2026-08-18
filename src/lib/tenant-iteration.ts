import { db } from '@/lib/db';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';

/**
 * Пройти по всем действующим организациям, открывая контекст на каждую.
 *
 * Нужно фоновым задачам: у них нет запроса, а значит и контекста, который
 * заводит обёртка маршрута. Пока такая задача читала «безымянно», всё
 * работало на одной организации; при второй пересчёт одной затирал бы данные
 * другой, а после перевода политик RLS в fail-closed чтение без контекста
 * возвращало бы ноль строк — и задача молча очищала бы проекции вместо того,
 * чтобы их собрать.
 *
 * Контекст открывается на каждую организацию отдельно, а не один на весь
 * проход: общий смешал бы их между собой. Тот же приём в потребителе outbox
 * и планировщике ТО.
 *
 * Организации идут по очереди, а не разом. Параллельный проход дал бы
 * вложенные контексты в одном асинхронном стволе и выигрыш, которого при
 * нынешнем размере не видно.
 */
export async function forEachTenant<T>(run: (tenantId: string) => Promise<T>): Promise<T[]> {
  const tenants = await db.tenant.findMany({
    where: { isActive: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });

  const results: T[] = [];
  for (const { id } of tenants) {
    results.push(
      await runWithTenantContext(async () => {
        setRequestTenantId(id);
        return run(id);
      }),
    );
  }
  return results;
}
