import type {ReadinessTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import type {WorkInterval} from '../domain/work-interval';

type StoredInterval = Awaited<ReturnType<ReadinessTransaction['reportDowntime']['findFirst']>>;

function toDomain(row: NonNullable<StoredInterval>): WorkInterval {
  if (!row.tenantId || !row.shiftId || !row.clientCommandId || !row.kind || !row.status || !row.startedAt) {
    throw new Error('Запись интервала не содержит обязательные серверные реквизиты');
  }
  if (row.kind !== 'BREAK' && row.kind !== 'DOWNTIME') throw new Error('Неизвестный вид интервала');
  if (row.status !== 'OPEN' && row.status !== 'CLOSED') throw new Error('Неизвестное состояние интервала');
  return {
    id: row.id, tenantId: row.tenantId, shiftId: row.shiftId,
    clientCommandId: row.clientCommandId, kind: row.kind, status: row.status,
    startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSeconds,
    reason: row.reasonText, category: row.category, comment: row.comment,
    sourceResponsibility: row.sourceResponsibility, defectId: row.defectId,
    maintenanceRecordId: row.maintenanceRecordId,
    occurredAt: row.occurredAt ?? row.startedAt, receivedAt: row.receivedAt, version: row.version,
  };
}

export class WorkIntervalRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async byCommand(tenantId: string, clientCommandId: string): Promise<WorkInterval | null> {
    const row = await this.tx.reportDowntime.findUnique({
      where: {tenantId_clientCommandId: {tenantId, clientCommandId}},
    });
    return row ? toDomain(row) : null;
  }

  async open(tenantId: string, shiftId: string): Promise<WorkInterval | null> {
    const row = await this.tx.reportDowntime.findFirst({where: {tenantId, shiftId, status: 'OPEN'}});
    return row ? toDomain(row) : null;
  }

  async create(reportId: string, interval: WorkInterval): Promise<WorkInterval> {
    const row = await this.tx.reportDowntime.create({data: {
      id: interval.id, reportId, tenantId: interval.tenantId, shiftId: interval.shiftId,
      clientCommandId: interval.clientCommandId, reasonId: null, duration: 0,
      kind: interval.kind, status: interval.status, startedAt: interval.startedAt,
      endedAt: null, durationSeconds: null, reasonText: interval.reason,
      category: interval.category, comment: interval.comment,
      sourceResponsibility: interval.sourceResponsibility, defectId: interval.defectId,
      maintenanceRecordId: interval.maintenanceRecordId, occurredAt: interval.occurredAt,
      receivedAt: interval.receivedAt, version: interval.version,
    }});
    return toDomain(row);
  }

  async close(interval: WorkInterval): Promise<void> {
    const changed = await this.tx.reportDowntime.updateMany({
      where: {tenantId: interval.tenantId, id: interval.id, status: 'OPEN', version: interval.version - 1},
      data: {status: 'CLOSED', endedAt: interval.endedAt, durationSeconds: interval.durationSeconds,
        duration: (interval.durationSeconds ?? 0) / 3600, version: interval.version},
    });
    if (changed.count !== 1) throw new Error('Интервал уже изменён другим запросом');
  }
}
