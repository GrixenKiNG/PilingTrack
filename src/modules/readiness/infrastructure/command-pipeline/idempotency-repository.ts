import {Prisma} from '@/generated/postgres-client/client';
import {randomUUID} from 'node:crypto';
import type {ReadinessTransaction} from '../tenant-transaction';
import type {
  CommandIdempotencyRepository,
  StoredCommandResult,
} from '../../application/command-pipeline/execute-command';

/**
 * The legacy IdempotencyKey table still has a global (scope, key) unique
 * constraint for existing non-readiness callers. Prefix readiness scopes with
 * an unambiguous tenant envelope so identical client keys remain independent
 * across tenants without weakening that legacy guarantee.
 */
export function tenantStorageScope(tenantId: string, scope: string): string {
  return `${tenantId.length}:${tenantId}:${scope}`;
}

export class PrismaCommandIdempotencyRepository implements CommandIdempotencyRepository {
  constructor(private readonly tx: ReadinessTransaction) {}

  async tryClaim(input: {
    tenantId: string;
    actorId: string;
    scope: string;
    key: string;
    requestHash: Uint8Array;
    expiresAt: Date;
  }): Promise<boolean> {
    const storageScope = tenantStorageScope(input.tenantId, input.scope);
    await this.tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
    const inserted = await this.tx.$queryRaw<Array<{id: string}>>(Prisma.sql`
      INSERT INTO "IdempotencyKey"
        ("id", "key", "scope", "status", "expiresAt", "createdAt", "tenantId", "actorId", "requestHash")
      VALUES
        (${randomUUID()}, ${input.key}, ${storageScope}, 'processing', ${input.expiresAt}, NOW(),
         ${input.tenantId}, ${input.actorId}, ${Buffer.from(input.requestHash)})
      ON CONFLICT ("tenantId", "scope", "key") DO NOTHING
      RETURNING "id"
    `);
    return inserted.length === 1;
  }

  async find(input: {tenantId: string; scope: string; key: string}): Promise<StoredCommandResult | null> {
    return this.tx.idempotencyKey.findFirst({
      where: {
        tenantId: input.tenantId,
        scope: tenantStorageScope(input.tenantId, input.scope),
        key: input.key,
      },
      select: {
        status: true,
        requestHash: true,
        statusCode: true,
        result: true,
        responseHeaders: true,
      },
    });
  }

  async complete(input: {
    tenantId: string;
    scope: string;
    key: string;
    statusCode: number;
    result: import('../../domain/audit/types').AuditJsonValue;
    responseHeaders: Record<string, string>;
  }): Promise<void> {
    const updated = await this.tx.idempotencyKey.updateMany({
      where: {
        tenantId: input.tenantId,
        scope: tenantStorageScope(input.tenantId, input.scope),
        key: input.key,
        status: 'processing',
      },
      data: {
        status: 'completed',
        statusCode: input.statusCode,
        result: input.result as Prisma.InputJsonValue,
        responseHeaders: input.responseHeaders,
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw new Error('Idempotency claim disappeared before completion');
  }
}
