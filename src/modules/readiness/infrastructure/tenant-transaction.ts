import type { Prisma } from '@/generated/postgres-client/client';
import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';

export type ReadinessTransaction = Prisma.TransactionClient;

type TransactionClient = Pick<typeof db, '$transaction'>;
type TenantWork<T> = (tx: ReadinessTransaction) => Promise<T>;

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
