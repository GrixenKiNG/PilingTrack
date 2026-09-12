import 'dotenv/config';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient, type Prisma} from '../../src/generated/postgres-client/client';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {applyTenantGuc, wrapTransaction} from '../../src/core/security/tenant-rls';
import {runWithTenantContext, setRequestTenantId} from '../../src/core/security/tenant-context';

const connectionString = process.env.DATABASE_URL_POSTGRES;
const suffix = randomBytes(6).toString('hex');
const database = 'qa_tenant_pool_' + suffix;
const role = 'qa_tenant_pool_role_' + suffix;
let admin: Client;
let setup: Client;
let prisma: PrismaClient;
let scoped: PrismaClient;
let createdDatabase = false;
let createdRole = false;

describe.skipIf(!connectionString)('lazy tenant transactions with a single database connection', () => {
  beforeAll(async () => {
    if (!connectionString) throw new Error('Postgres connection string is required');
    const url = new URL(connectionString);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Disposable transaction tests require local Postgres');
    admin = new Client({connectionString});
    await admin.connect();
    await admin.query('CREATE DATABASE "' + database + '"');
    createdDatabase = true;
    await admin.query('CREATE ROLE "' + role + '" NOLOGIN NOSUPERUSER NOBYPASSRLS');
    createdRole = true;
    url.pathname = '/' + database;
    setup = new Client({connectionString: url.toString()});
    await setup.connect();
    await setup.query('CREATE TABLE "Site" (id TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL)');
    await setup.query('INSERT INTO "Site" VALUES ($1,$2),($3,$4)', ['site-a','tenant-a','site-b','tenant-b']);
    await setup.query('ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY');
    await setup.query('ALTER TABLE "Site" FORCE ROW LEVEL SECURITY');
    await setup.query("CREATE POLICY tenant_isolation ON \"Site\" USING (\"tenantId\" = current_setting('app.current_tenant', true))");
    await setup.query('GRANT USAGE ON SCHEMA public TO "' + role + '"');
    await setup.query('GRANT SELECT, INSERT ON "Site" TO "' + role + '"');
    prisma = new PrismaClient({adapter: new PrismaPg({connectionString: url.toString(), max: 1, connectionTimeoutMillis: 1000, options: '-c role=' + role})});
    scoped = applyTenantGuc(prisma as never) as PrismaClient;
  }, 30000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await setup?.end();
    if (createdDatabase) await admin.query('DROP DATABASE "' + database + '" WITH (FORCE)');
    if (createdRole) await admin.query('DROP ROLE "' + role + '"');
    await admin?.end();
  });

  const transaction = <T>(tenantId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => runWithTenantContext(async () => {
    setRequestTenantId(tenantId);
    return wrapTransaction(scoped as never, scoped.$transaction as never, [work, {timeout: 3000, maxWait: 1000}]) as Promise<T>;
  });
  const sites = (tx: Prisma.TransactionClient) => tx.site.findMany({select: {id: true, tenantId: true}});

  it('uses a role which cannot bypass RLS', async () => {
    const rows = await prisma.$queryRaw<Array<{rolsuper: boolean; rolbypassrls: boolean}>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rows).toEqual([{rolsuper: false, rolbypassrls: false}]);
  });
  it('executes lazy callbacks without a second connection and keeps tenant rows separate', async () => {
    expect(await transaction('tenant-a', sites)).toEqual([{id: 'site-a', tenantId: 'tenant-a'}]);
    expect(await transaction('tenant-b', sites)).toEqual([{id: 'site-b', tenantId: 'tenant-b'}]);
    expect(await transaction('unknown-tenant', sites)).toEqual([]);
  });
  it('does not retain tenant context when the connection returns to the pool', async () => {
    await transaction('tenant-a', sites);
    expect(await sites(scoped)).toEqual([]);
  });
  it('rolls back writes when the callback fails', async () => {
    await expect(transaction('tenant-a', async tx => {
      await tx.$executeRaw`INSERT INTO "Site" VALUES ('rollback-site', 'tenant-a')`;
      throw new Error('rollback requested');
    })).rejects.toThrow('rollback requested');
    expect(await transaction('tenant-a', sites)).toEqual([{id: 'site-a', tenantId: 'tenant-a'}]);
  });
});
