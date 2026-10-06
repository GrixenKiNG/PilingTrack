/**
 * withTenantContext — транзакция с организацией для строгого RLS.
 *
 * Раньше здесь же жили requireTenant, tenantWhere, assertTenantOwnership,
 * resolveTenantId, validateTenantExists, enforceTenantPlan, getUserSites,
 * assertUserHasSiteAccess, setPostgresTenantContext и своё хранилище
 * контекста (runWithTenantContext/getCurrentTenantContext). Ни один из них не
 * вызывался приложением (живой контекст — core/security/tenant-context.ts,
 * живые помощники — services/tenancy/), а независимый аудит (Codex out55,
 * F03, F17) нашёл в них проход при отсутствии организации (fail-open) и
 * установку организации, которая тихо не срабатывала. Удалены 01.10.2026,
 * чтобы их не подключили по ошибке.
 */

import { ServiceError } from '@/lib/service-error';

/**
 * Run a callback inside a transaction with PostgreSQL session variable
 * `app.current_tenant` set transaction-locally. The migration
 * `20260425000000_enable_rls_foundation` reads this variable to enforce RLS
 * on Report/Site/User.
 *
 * Connection-level SET is unreliable with Prisma's connection pool — a
 * follow-up query may be served from a different connection where the
 * variable was never set. set_config with the
 * third arg `true` is transaction-local and survives only within
 * $transaction's callback, which is the safe default.
 *
 * Usage:
 *   await withTenantContext(user.tenantId!, async (tx) => {
 *     return tx.report.findMany();  // RLS-filtered to user's tenant
 *   });
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: unknown) => Promise<T>
): Promise<T> {
  if (!tenantId) {
    throw new ServiceError('withTenantContext requires a tenantId', 500);
  }
  const { db } = await import('@/lib/db');
  return db.$transaction(async (tx) => {
    // set_config(name, value, is_local=true) — transaction-scoped, like SET LOCAL.
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx);
  });
}
