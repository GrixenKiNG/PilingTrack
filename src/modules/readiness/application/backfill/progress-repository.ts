import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';

export class ReadinessBackfillProgressRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  get(tenantId: string) {
    return this.tx.readinessBackfillProgress.findUnique({where: {tenantId}});
  }

  start(tenantId: string) {
    return this.tx.readinessBackfillProgress.upsert({
      where: {tenantId},
      create: {tenantId, status: 'RUNNING'},
      // Позицию и счётчик сбрасываем: без этого повторный прогон продолжает
      // с прошлого lastEquipmentId и молча пропускает всю технику до него.
      update: {
        status: 'RUNNING', completedAt: null, lastError: null,
        lastEquipmentId: null, processedCount: 0,
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
