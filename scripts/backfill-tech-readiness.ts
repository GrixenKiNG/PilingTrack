import 'dotenv/config';
import {db} from '../src/lib/db';
import {backfillTenantReadiness} from '../src/modules/readiness/application/backfill/backfill-service';

async function main() {
  const requestedTenant = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice('--tenant='.length);
  const tenants = requestedTenant
    ? [{id: requestedTenant}]
    : await db.tenant.findMany({select: {id: true}, orderBy: {id: 'asc'}});
  for (const tenant of tenants) {
    const result = await backfillTenantReadiness({tenantId: tenant.id});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.reconciled) process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
