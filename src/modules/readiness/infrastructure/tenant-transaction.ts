import type { Prisma } from '@/generated/postgres-client/client';
import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import {ReadinessCommandError} from '../application/command-pipeline/errors';

export type ReadinessTransaction = Prisma.TransactionClient;

type TransactionClient = Pick<typeof db, '$transaction'>;
type TenantWork<T> = (tx: ReadinessTransaction) => Promise<T>;
type SerializableTransactionOptions = {
  resolveConflictDetails?: () => Promise<Record<string, unknown> | undefined>;
};

function requireSessionTenantId(tenantId: string | null | undefined): string {
  const value = tenantId?.trim();
  if (!value) {
    throw new Error('Readiness tenant context is required');
  }
  return value;
}

export async function runReadinessTenantTransaction<T>(
  client: TransactionClient,
  tenantId: string | null | undefined,
  work: TenantWork<T>
): Promise<T> {
  const scopedTenantId = requireSessionTenantId(tenantId);

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${scopedTenantId}, true)`;
    const context = await tx.$queryRaw<Array<{ tenant_id: string | null }>>`
      SELECT current_setting('app.current_tenant', true) AS tenant_id
    `;
    if (context[0]?.tenant_id !== scopedTenantId) {
      throw new Error('Readiness tenant context could not be established');
    }
    return work(tx);
  }, DEFAULT_TX_OPTIONS);
}

export function withReadinessTenantTransaction<T>(
  tenantId: string | null | undefined,
  work: TenantWork<T>
): Promise<T> {
  return runReadinessTenantTransaction(db, tenantId, work);
}

export const withReadinessRequestTransaction = withReadinessTenantTransaction;
export const withReadinessWorkerTransaction = withReadinessTenantTransaction;

const SERIALIZABLE_ATTEMPTS = 3;

/** 40001 — сериализационный конфликт, 40P01 — взаимная блокировка. */
const RETRYABLE_PG_CODES = new Set(['40001', '40P01']);

/**
 * Код Postgres из ошибки Prisma, где бы он ни лежал.
 *
 * Драйверный адаптер (PrismaPg) не поднимает код наверх: сериализационный сбой
 * приходит как P2010 «Raw query failed», а настоящий 40001 спрятан в
 * meta.driverAdapterError.cause.originalCode. Пока разбирали только code и
 * meta.code, такая ошибка не считалась конфликтом: транзакция не повторялась,
 * а наружу вместо 409 «Одновременное изменение» уходил сырой P2010. Ловилось
 * это как «плавающее» падение теста на 20 параллельных запусках.
 */
function postgresErrorCode(error: unknown): string | null {
  const candidate = error as {
    code?: string;
    meta?: {code?: string; driverAdapterError?: {cause?: {originalCode?: string}}};
  };
  return candidate.meta?.driverAdapterError?.cause?.originalCode
    ?? candidate.meta?.code
    ?? candidate.code
    ?? null;
}

function isSerializableConflict(error: unknown): boolean {
  if ((error as {code?: string}).code === 'P2034') return true;
  const code = postgresErrorCode(error);
  return code !== null && RETRYABLE_PG_CODES.has(code);
}

export async function runReadinessSerializableTransaction<T>(
  client: TransactionClient,
  tenantId: string | null | undefined,
  work: TenantWork<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  const scopedTenantId = requireSessionTenantId(tenantId);
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${scopedTenantId}, true)`;
        const context = await tx.$queryRaw<Array<{ tenant_id: string | null }>>`
          SELECT current_setting('app.current_tenant', true) AS tenant_id
        `;
        if (context[0]?.tenant_id !== scopedTenantId) {
          throw new Error('Readiness tenant context could not be established');
        }
        return work(tx);
      }, {...DEFAULT_TX_OPTIONS, isolationLevel: 'Serializable'});
    } catch (error) {
      if (!isSerializableConflict(error)) throw error;
      if (attempt === SERIALIZABLE_ATTEMPTS) {
        let details: Record<string, unknown> | undefined;
        try {
          details = await options.resolveConflictDetails?.();
        } catch {
          // Conflict diagnostics are best-effort and must never replace the stable API contract.
        }
        throw new ReadinessCommandError(
          'VERSION_CONFLICT',
          409,
          'Одновременное изменение. Повторите действие',
          details,
          {'Retry-After': '1'},
        );
      }
    }
  }
  throw new Error('Serializable readiness transaction retry exhausted');
}

export function withReadinessSerializableTransaction<T>(
  tenantId: string | null | undefined,
  work: TenantWork<T>,
  options: SerializableTransactionOptions = {},
): Promise<T> {
  return runReadinessSerializableTransaction(db, tenantId, work, options);
}
