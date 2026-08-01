import type {ReadinessTransaction} from '../tenant-transaction';

export class ReadinessOutboxRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  find(tenantId: string, eventId: string) {
    return this.tx.outboxEvent.findFirst({where: {id: eventId, tenantId}});
  }

  markProjected(tenantId: string, eventId: string) {
    return this.tx.outboxEvent.updateMany({
      where: {id: eventId, tenantId, projected: false},
      data: {projected: true, lastError: null, nextRetryAt: null},
    });
  }
}
