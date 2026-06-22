import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client } from 'pg';

export interface TenantDictionaryVerification {
  ok: boolean;
  nullTenantRows: number;
  duplicateNames: number;
  crossTenantLinks: number;
  pileWorkLinks: number;
  drillingLinks: number;
  downtimeLinks: number;
  planLinks: number;
}

export async function verifyTenantDictionaryMigration(
  client: Pick<Client, 'query'>
): Promise<TenantDictionaryVerification> {
  const result = await client.query<TenantDictionaryVerification>(`
    SELECT
      (
        (SELECT COUNT(*) FROM "PileGrade" WHERE "tenantId" IS NULL)
        + (SELECT COUNT(*) FROM "DrillingType" WHERE "tenantId" IS NULL)
        + (SELECT COUNT(*) FROM "DowntimeReason" WHERE "tenantId" IS NULL)
      )::int AS "nullTenantRows",
      (
        SELECT COUNT(*)::int FROM (
          SELECT "tenantId", "normalizedName" FROM "PileGrade" GROUP BY 1, 2 HAVING COUNT(*) > 1
          UNION ALL
          SELECT "tenantId", "normalizedName" FROM "DrillingType" GROUP BY 1, 2 HAVING COUNT(*) > 1
          UNION ALL
          SELECT "tenantId", "normalizedName" FROM "DowntimeReason" GROUP BY 1, 2 HAVING COUNT(*) > 1
        ) duplicates
      ) AS "duplicateNames",
      (
        SELECT COUNT(*)::int FROM (
          SELECT pw."id" FROM "PileWork" pw
            JOIN "Report" r ON r."id" = pw."reportId"
            JOIN "PileGrade" d ON d."id" = pw."pileGradeId"
            WHERE d."tenantId" IS DISTINCT FROM r."tenantId"
          UNION ALL
          SELECT ld."id" FROM "LeaderDrilling" ld
            JOIN "Report" r ON r."id" = ld."reportId"
            JOIN "DrillingType" d ON d."id" = ld."typeId"
            WHERE d."tenantId" IS DISTINCT FROM r."tenantId"
          UNION ALL
          SELECT rd."id" FROM "ReportDowntime" rd
            JOIN "Report" r ON r."id" = rd."reportId"
            JOIN "DowntimeReason" d ON d."id" = rd."reasonId"
            WHERE d."tenantId" IS DISTINCT FROM r."tenantId"
          UNION ALL
          SELECT sp."id" FROM "SitePilePlan" sp
            JOIN "Site" s ON s."id" = sp."siteId"
            JOIN "PileGrade" d ON d."id" = sp."pileGradeId"
            WHERE d."tenantId" IS DISTINCT FROM s."tenantId"
        ) mismatches
      ) AS "crossTenantLinks",
      (SELECT COUNT(*)::int FROM "PileWork") AS "pileWorkLinks",
      (SELECT COUNT(*)::int FROM "LeaderDrilling") AS "drillingLinks",
      (SELECT COUNT(*)::int FROM "ReportDowntime") AS "downtimeLinks",
      (SELECT COUNT(*)::int FROM "SitePilePlan") AS "planLinks"
  `);
  const row = result.rows[0];
  if (!row) throw new Error('Tenant dictionary verification returned no result');

  return {
    ...row,
    ok: row.nullTenantRows === 0 && row.duplicateNames === 0 && row.crossTenantLinks === 0,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL_POSTGRES;
  if (!connectionString) throw new Error('DATABASE_URL_POSTGRES is required');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await verifyTenantDictionaryMigration(client);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
