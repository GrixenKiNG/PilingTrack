import {Prisma} from '@/generated/postgres-client/client';
import type {ReadinessTransaction} from '../tenant-transaction';
import type {AuditChainHead, CanonicalAuditEvent, StoredAuditEvent} from '../../domain/audit/types';

export interface AuditRepository {
  ensureChain(tenantId: string): Promise<void>;
  lockChain(tenantId: string): Promise<AuditChainHead>;
  insert(event: StoredAuditEvent): Promise<void>;
  advanceChain(tenantId: string, previousSequence: bigint, hash: Uint8Array): Promise<void>;
  readChain(tenantId: string): Promise<{events: StoredAuditEvent[]; head: AuditChainHead | null}>;
}

const jsonInput = (value: CanonicalAuditEvent['before']) =>
  value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;

const ownedBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(new ArrayBuffer(value.byteLength));
  result.set(value);
  return result;
};

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async ensureChain(tenantId: string): Promise<void> {
    await this.tx.$executeRaw`
      INSERT INTO "TenantAuditChain" ("tenantId", "lastSequence", "updatedAt")
      VALUES (${tenantId}, 0, NOW())
      ON CONFLICT ("tenantId") DO NOTHING
    `;
  }

  async lockChain(tenantId: string): Promise<AuditChainHead> {
    const rows = await this.tx.$queryRaw<Array<AuditChainHead>>`
      SELECT "lastSequence", "headHash"
      FROM "TenantAuditChain"
      WHERE "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error('Tenant audit chain could not be locked');
    return rows[0];
  }

  async insert(event: StoredAuditEvent): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        id: event.id,
        tenantId: event.tenantId,
        sequence: BigInt(event.sequence),
        occurredAt: new Date(event.occurredAt),
        recordedAt: new Date(event.recordedAt),
        timestamp: new Date(event.recordedAt),
        actorId: event.actor.id ?? null,
        userId: event.actor.id ?? null,
        userName: event.actor.name ?? null,
        userRole: event.actor.role ?? null,
        actingAs: event.actor.actingAs ?? null,
        action: event.action,
        entity: event.entity.type,
        entityType: event.entity.type,
        entityId: event.entity.id,
        entityVersion: event.entity.version,
        requestId: event.requestId,
        correlationId: event.correlationId,
        idempotencyKeyHash: event.idempotencyKeyHash
          ? Uint8Array.from(Buffer.from(event.idempotencyKeyHash, 'hex'))
          : null,
        before: jsonInput(event.before),
        after: jsonInput(event.after),
        metadata: jsonInput(event.metadata),
        prevHash: event.prevHash ? Uint8Array.from(Buffer.from(event.prevHash, 'hex')) : null,
        hash: Uint8Array.from(Buffer.from(event.hash, 'hex')),
      },
    });
  }

  async advanceChain(tenantId: string, previousSequence: bigint, hash: Uint8Array): Promise<void> {
    const updated = await this.tx.tenantAuditChain.updateMany({
      where: {tenantId, lastSequence: previousSequence},
      data: {lastSequence: previousSequence + BigInt(1), headHash: ownedBytes(hash)},
    });
    if (updated.count !== 1) throw new Error('Tenant audit chain head changed while locked');
  }

  async readChain(tenantId: string): Promise<{events: StoredAuditEvent[]; head: AuditChainHead | null}> {
    const [rows, head] = await Promise.all([
      this.tx.auditLog.findMany({
        where: {tenantId, hash: {not: null}},
        orderBy: [{sequence: 'asc'}, {id: 'asc'}],
      }),
      this.tx.tenantAuditChain.findUnique({where: {tenantId}}),
    ]);
    const events = rows.map((row): StoredAuditEvent => {
      /*
        Запрос отбирает строки по `hash: {not: null}` — значит непустым
        гарантирован ТОЛЬКО хэш. Остальные поля цепочки (tenantId, sequence,
        occurredAt, recordedAt, entityType) по схеме допускают пустоту и ничем
        здесь не отфильтрованы, а стояло на них шесть утверждений «точно не
        пусто». Строка с хэшем и без порядкового номера роняла бы чтение
        цепочки как `Cannot read properties of null`.

        Такая строка означает повреждённую цепочку аудита. Собрать из неё
        событие молча нельзя: это выдало бы испорченный аудит за целый — ровно
        то, ради чего цепочка и заводилась. Отказываем с указанием строки.
      */
      if (
        row.tenantId === null || row.sequence === null || row.occurredAt === null
        || row.recordedAt === null || row.entityType === null || row.hash === null
      ) {
        throw new Error(`Audit chain row ${row.id} is incomplete: chained fields are missing`);
      }
      return {
      id: row.id,
      tenantId: row.tenantId,
      sequence: row.sequence.toString(),
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      actor: {
        id: row.actorId,
        name: row.userName,
        role: row.userRole,
        actingAs: row.actingAs,
      },
      action: row.action,
      entity: {type: row.entityType, id: row.entityId, version: row.entityVersion},
      requestId: row.requestId,
      correlationId: row.correlationId,
      idempotencyKeyHash: row.idempotencyKeyHash
        ? Buffer.from(row.idempotencyKeyHash).toString('hex')
        : null,
      before: row.before as CanonicalAuditEvent['before'],
      after: row.after as CanonicalAuditEvent['after'],
      metadata: row.metadata as CanonicalAuditEvent['metadata'],
      prevHash: row.prevHash ? Buffer.from(row.prevHash).toString('hex') : null,
      hash: Buffer.from(row.hash).toString('hex'),
      };
    });
    return {
      events,
      head: head ? {lastSequence: head.lastSequence, headHash: head.headHash} : null,
    };
  }
}
