import {db} from '@/lib/db';
import {capturedClock} from '../../domain/evaluation/clock';
import {withReadinessWorkerTransaction} from '../../infrastructure/tenant-transaction';
import {ReadinessOutboxRepository} from '../../infrastructure/snapshots/outbox-repository';
import {createDeduplicatedSnapshot} from '../../infrastructure/snapshots/snapshot-repository';
import {evaluateAuthoritativeReadiness} from '../readiness-score';
import {advanceCurrentReadiness} from './current-read-model';

interface SnapshotRequestPayload {
  equipmentId: string;
  shiftId?: string;
  triggerType: string;
  triggerId: string;
  triggerOccurredAt?: string;
}

function parsePayload(value: unknown): SnapshotRequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid readiness event payload');
  const row = value as Record<string, unknown>;
  for (const key of ['equipmentId', 'triggerType', 'triggerId'] as const) {
    if (typeof row[key] !== 'string' || !row[key]) throw new Error(`Readiness event payload is missing ${key}`);
  }
  return row as unknown as SnapshotRequestPayload;
}

export async function projectReadinessEvent(eventId: string) {
  const envelope = await db.outboxEvent.findUnique({
    where: {id: eventId}, select: {id: true, tenantId: true, type: true, projected: true},
  });
  if (!envelope) throw new Error('Readiness outbox event was not found');
  if (envelope.type !== 'ReadinessSnapshotRequested') throw new Error('Unsupported readiness event type');
  /*
    Тенант вынесен в переменную, а не читается как `envelope.tenantId` внутри
    транзакции. Проверка ниже сужает тип, но сужение СВОЙСТВА не переживает
    переход в замыкание — компилятор допускает, что объект успел измениться, и
    внутри требует `!`. Шесть таких утверждений здесь и стояли: не обман, а
    обход слепоты компилятора, но по виду неотличимый от настоящего «доверься
    мне». Локальная константа сужается честно и один раз.
  */
  const tenantId = envelope.tenantId;
  if (!tenantId) throw new Error('Readiness outbox event has no tenant');
  if (envelope.projected) return {projected: false, duplicate: true};

  return withReadinessWorkerTransaction(tenantId, async (tx) => {
    const outbox = new ReadinessOutboxRepository(tx);
    const event = await outbox.find(tenantId, eventId);
    if (!event) throw new Error('Tenant-scoped readiness outbox event was not found');
    if (event.projected) return {projected: false, duplicate: true};
    const payload = parsePayload(event.payload);
    const capturedAt = payload.triggerOccurredAt ? new Date(payload.triggerOccurredAt) : event.occurredAt;
    if (Number.isNaN(capturedAt.getTime())) throw new Error('Readiness event clock is invalid');
    const settings = await tx.tenantSettings.findUnique({
      where: {tenantId}, select: {timezone: true},
    });
    const evaluation = await evaluateAuthoritativeReadiness({
      tx, tenantId, equipmentId: payload.equipmentId,
      shiftId: payload.shiftId ?? null, timezone: settings?.timezone ?? 'Europe/Moscow',
      clock: capturedClock(capturedAt),
    });
    const snapshot = await createDeduplicatedSnapshot(tx, {
      tenantId, equipmentId: payload.equipmentId,
      shiftId: payload.shiftId ?? null, ruleSetId: evaluation.ruleSetId,
      triggerType: payload.triggerType, triggerId: payload.triggerId,
    }, evaluation);
    await advanceCurrentReadiness({
      tx, tenantId, equipmentId: payload.equipmentId,
      snapshotId: snapshot.id, status: snapshot.status, verdict: snapshot.verdict,
      score: snapshot.score, calculatedAt: snapshot.calculatedAt,
    });
    await outbox.markProjected(tenantId, eventId);
    return {projected: true, duplicate: false, snapshotId: snapshot.id};
  });
}
