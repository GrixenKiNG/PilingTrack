import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyTenantDictionaryMigration } from '../../scripts/verify-tenant-dictionary-migration';

const connectionString = process.env.DATABASE_URL_POSTGRES;
const migrationPath = resolve(
  process.cwd(),
  'prisma/migrations/20260622020000_tenant_dictionaries/migration.sql'
);

describe.runIf(Boolean(connectionString))('tenant dictionary migration on PostgreSQL', () => {
  const schema = `tenant_dict_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const client = new Client({ connectionString });

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Site" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL);
      CREATE TABLE "Report" ("id" TEXT PRIMARY KEY, "tenantId" TEXT, "siteId" TEXT NOT NULL);

      CREATE TABLE "PileGrade" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "lengthMm" INTEGER,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE "DrillingType" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE "DowntimeReason" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE "PileWork" ("id" TEXT PRIMARY KEY, "reportId" TEXT NOT NULL, "pileGradeId" TEXT NOT NULL);
      CREATE TABLE "LeaderDrilling" ("id" TEXT PRIMARY KEY, "reportId" TEXT NOT NULL, "typeId" TEXT NOT NULL);
      CREATE TABLE "ReportDowntime" ("id" TEXT PRIMARY KEY, "reportId" TEXT NOT NULL, "reasonId" TEXT NOT NULL);
      CREATE TABLE "SitePilePlan" ("id" TEXT PRIMARY KEY, "siteId" TEXT NOT NULL, "pileGradeId" TEXT NOT NULL);

      INSERT INTO "Tenant" ("id") VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO "Site" ("id", "tenantId") VALUES ('site-a', 'tenant-a'), ('site-b', 'tenant-b');
      INSERT INTO "Report" ("id", "tenantId", "siteId") VALUES
        ('report-a', 'tenant-a', 'site-a'),
        ('report-b', 'tenant-b', 'site-b');

      INSERT INTO "PileGrade" ("id", "name", "lengthMm") VALUES ('grade-global', 'С120.30-8', 12000);
      INSERT INTO "DrillingType" ("id", "name") VALUES ('drill-global', 'Лидерное бурение');
      INSERT INTO "DowntimeReason" ("id", "name") VALUES ('reason-global', 'Ожидание бетона');

      INSERT INTO "PileWork" ("id", "reportId", "pileGradeId") VALUES
        ('pile-a', 'report-a', 'grade-global'),
        ('pile-b', 'report-b', 'grade-global');
      INSERT INTO "LeaderDrilling" ("id", "reportId", "typeId") VALUES
        ('drill-a', 'report-a', 'drill-global'),
        ('drill-b', 'report-b', 'drill-global');
      INSERT INTO "ReportDowntime" ("id", "reportId", "reasonId") VALUES
        ('down-a', 'report-a', 'reason-global'),
        ('down-b', 'report-b', 'reason-global');
      INSERT INTO "SitePilePlan" ("id", "siteId", "pileGradeId") VALUES
        ('plan-a', 'site-a', 'grade-global'),
        ('plan-b', 'site-b', 'grade-global');
    `);
  });

  afterAll(async () => {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it('creates independent tenant copies and preserves every link and grade length', async () => {
    await client.query(await readFile(migrationPath, 'utf8'));

    const grades = await client.query<{
      id: string;
      tenantId: string;
      lengthMm: number | null;
      normalizedName: string;
    }>('SELECT "id", "tenantId", "lengthMm", "normalizedName" FROM "PileGrade" ORDER BY "tenantId"');
    expect(grades.rows).toHaveLength(2);
    expect(grades.rows.map((row) => row.tenantId)).toEqual(['tenant-a', 'tenant-b']);
    expect(grades.rows.map((row) => row.lengthMm)).toEqual([12000, 12000]);
    expect(new Set(grades.rows.map((row) => row.id)).size).toBe(2);
    expect(grades.rows.every((row) => row.normalizedName === 'с120.30-8')).toBe(true);

    const linkCheck = await client.query<{
      pileLinks: number;
      drillLinks: number;
      downtimeLinks: number;
      planLinks: number;
      mismatches: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::int FROM "PileWork") AS "pileLinks",
        (SELECT COUNT(*)::int FROM "LeaderDrilling") AS "drillLinks",
        (SELECT COUNT(*)::int FROM "ReportDowntime") AS "downtimeLinks",
        (SELECT COUNT(*)::int FROM "SitePilePlan") AS "planLinks",
        (
          SELECT COUNT(*)::int FROM (
            SELECT pw."id" FROM "PileWork" pw
              JOIN "Report" r ON r."id" = pw."reportId"
              JOIN "PileGrade" d ON d."id" = pw."pileGradeId"
              WHERE d."tenantId" <> r."tenantId"
            UNION ALL
            SELECT ld."id" FROM "LeaderDrilling" ld
              JOIN "Report" r ON r."id" = ld."reportId"
              JOIN "DrillingType" d ON d."id" = ld."typeId"
              WHERE d."tenantId" <> r."tenantId"
            UNION ALL
            SELECT rd."id" FROM "ReportDowntime" rd
              JOIN "Report" r ON r."id" = rd."reportId"
              JOIN "DowntimeReason" d ON d."id" = rd."reasonId"
              WHERE d."tenantId" <> r."tenantId"
            UNION ALL
            SELECT sp."id" FROM "SitePilePlan" sp
              JOIN "Site" s ON s."id" = sp."siteId"
              JOIN "PileGrade" d ON d."id" = sp."pileGradeId"
              WHERE d."tenantId" <> s."tenantId"
          ) mismatched
        ) AS "mismatches"
    `);

    expect(linkCheck.rows[0]).toEqual({
      pileLinks: 2,
      drillLinks: 2,
      downtimeLinks: 2,
      planLinks: 2,
      mismatches: 0,
    });

    await expect(verifyTenantDictionaryMigration(client)).resolves.toMatchObject({
      ok: true,
      nullTenantRows: 0,
      duplicateNames: 0,
      crossTenantLinks: 0,
      pileWorkLinks: 2,
      drillingLinks: 2,
      downtimeLinks: 2,
      planLinks: 2,
    });
  });
});
