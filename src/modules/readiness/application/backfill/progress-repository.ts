import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';

export class ReadinessBackfillProgressRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  get(tenantId: string) {
    return this.tx.readinessBackfillProgress.findUnique({where: {tenantId}});
  }

  /**
   * Начать или продолжить прогон.
   *
   * Здесь два разных случая, и различать их обязательно:
   *
   * • прошлый прогон оборвался (RUNNING или FAILED) — это ПРОДОЛЖЕНИЕ.
   *   Контрольную точку трогать нельзя, иначе после сбоя на середине парка
   *   всё пересчитывается заново;
   * • прошлый прогон завершился (COMPLETED) либо его не было — это НОВЫЙ
   *   прогон, обычно после публикации новых правил. Здесь точку наоборот
   *   надо сбросить: иначе прогон стартует с прошлого lastEquipmentId и
   *   молча пропускает всю технику до него, а новые правила до неё не
   *   доезжают.
   */
  async start(tenantId: string) {
    const previous = await this.get(tenantId);
    const resuming = previous?.status === 'RUNNING' || previous?.status === 'FAILED';
    return this.tx.readinessBackfillProgress.upsert({
      where: {tenantId},
      create: {tenantId, status: 'RUNNING'},
      update: {
        status: 'RUNNING', completedAt: null, lastError: null,
        ...(resuming ? {} : {lastEquipmentId: null, processedCount: 0}),
      },
    });
  }

  checkpoint(input: {tenantId: string; lastEquipmentId: string; processed: number}) {
    return this.tx.readinessBackfillProgress.update({
      where: {tenantId: input.tenantId},
      data: {lastEquipmentId: input.lastEquipmentId, processedCount: {increment: input.processed}},
    });
  }

  fail(tenantId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return this.tx.readinessBackfillProgress.update({
      where: {tenantId},
      data: {status: 'FAILED', errorCount: {increment: 1}, lastError: message.slice(0, 1000)},
    });
  }

  complete(tenantId: string, completedAt: Date) {
    return this.tx.readinessBackfillProgress.update({
      where: {tenantId}, data: {status: 'COMPLETED', completedAt, lastError: null},
    });
  }
}
