// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PrismaClient, type Prisma } from '@/generated/postgres-client/client';
import { SerializedPrismaPg } from '@/core/infrastructure/serialized-prisma-pg';
import { createFixture } from './helpers/disposable-db';

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_APP)('Prisma transaction scheduling on disposable PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let prisma: PrismaClient;
  let pool: Pool;
  const warnings: string[] = [];
  const onWarning = (warning: Error) => {
    if (warning.message.includes('Calling client.query()')) warnings.push(warning.message);
  };

  beforeAll(async () => {
    fixture = await createFixture();
    pool = new Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL_APP, max: 1 });
    prisma = new PrismaClient({ adapter: new SerializedPrismaPg(pool, { disposeExternalPool: true }) });
    process.on('warning', onWarning);
  });
  afterAll(async () => {
    process.removeListener('warning', onWarning);
    await prisma?.$disconnect();
    await fixture?.close();
  });

  function inTenant<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    return prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${fixture.tenants[0]}, true)`;
      return work(tx);
    });
  }

  it('loads sibling report relations without overlapping SQL on the borrowed client', async () => {
    const report = await inTenant(tx => tx.report.findUniqueOrThrow({
      where: { id: fixture.id(fixture.tenants[0], 'Report') },
      include: { piles: true, drillings: true, downtimes: true },
    }));
    expect(report.tenantId).toBe(fixture.tenants[0]);
    expect([report.piles, report.drillings, report.downtimes]).toEqual([[], [], []]);
    await new Promise(resolve => setImmediate(resolve));
    expect(warnings).toEqual([]);
  });

  it('rolls back a write when application work fails', async () => {
    await expect(inTenant(async tx => {
      await tx.report.update({
        where: { id: fixture.id(fixture.tenants[0], 'Report') }, data: { status: 'submitted' },
      });
      throw new Error('rollback fixture');
    })).rejects.toThrow('rollback fixture');
    const report = await inTenant(tx => tx.report.findUniqueOrThrow({
      where: { id: fixture.id(fixture.tenants[0], 'Report') },
    }));
    expect(report.status).toBe('draft');
  });

  it('returns the connection after an SQL error', async () => {
    await expect(inTenant(tx => tx.$queryRaw`SELECT 1 / 0 AS invalid`)).rejects.toThrow();
    expect(await prisma.$queryRaw`SELECT 1::int AS value`).toEqual([{ value: 1 }]);
    expect(pool.idleCount).toBe(1);
  });

  it('finishes pending SQL before reusing a connection after timeout', async () => {
    await expect(prisma.$transaction(
      tx => tx.$queryRaw`SELECT 1::int AS value FROM pg_sleep(0.2)`,
      { timeout: 50 },
    )).rejects.toThrow(/expired|timeout/i);
    expect(await prisma.$queryRaw`SELECT 1::int AS value`).toEqual([{ value: 1 }]);
    expect(pool.idleCount).toBe(1);
  });

  it('serves competing transactions through a one-connection pool after failures', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => inTenant(tx => tx.report.findMany({
      select: { tenantId: true, piles: true, drillings: true, downtimes: true },
    }))));
    expect(results).toHaveLength(8);
    for (const reports of results) expect(reports.every(report => report.tenantId === fixture.tenants[0])).toBe(true);
    expect(pool.totalCount).toBe(1);
    expect(pool.idleCount).toBe(1);
    expect(warnings).toEqual([]);
  });
});
