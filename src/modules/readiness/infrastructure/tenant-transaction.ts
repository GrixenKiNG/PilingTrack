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

function isSerializableConflict(error: unknown): boolean {
  const candidate = error as {code?: string; meta?: {code?: string}};
  return candidate.code === 'P2034'
    || candidate.code === '40001'
    || candidate.code === '40P01'
    || candidate.meta?.code === '40001'
    || candidate.meta?.code === '40P01';
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
