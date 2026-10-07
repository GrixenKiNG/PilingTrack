// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFixture } from './helpers/disposable-db';
import { getSiteAnalytics } from '@/modules/analytics';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { listPilePassports } from '@/modules/reports/application/queries/pile-passport.service';

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('E5 combined pile aggregate semantics', () => {
  it('период не меняет накопительный итог и не включает черновик', async () => {
    const fixture=await createFixture(); const tenant=fixture.tenants[0]; const grade=tenant+'-grade'; const second=tenant+'-report-second'; const draft=tenant+'-report-draft';
    try {
      await fixture.owner.query('INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","lengthMm","updatedAt") VALUES ($1,$2,$1,$1,6000,now())',[grade,tenant]);
      await fixture.owner.query('UPDATE "Report" SET status=$1,date=$2 WHERE id=$3',['submitted','2026-10-01',fixture.id(tenant,'Report')]);
      for(const [id,status,count,date] of [[fixture.id(tenant,'Report'),'submitted',4,'2026-10-01'],[second,'submitted',7,'2026-10-02'],[draft,'draft',100,'2026-10-03']] as const) {
        if(id!==fixture.id(tenant,'Report')) await fixture.owner.query('INSERT INTO "Report" (id,"reportId","tenantId","userId","siteId",date,status,"updatedAt") VALUES ($1,$1,$2,$3,$4,$5,$6,now())',[id,tenant,fixture.id(tenant,'User'),fixture.id(tenant,'Site'),date,status]);
        await fixture.owner.query('INSERT INTO "PileWork" (id,"reportId","tenantId","pileGradeId",count) VALUES ($1,$2,$3,$4,$5)',[id+'-pile',id,tenant,grade,count]);
      }
      const rows=await runWithTenantContext(async()=>{setRequestTenantId(tenant);return getSiteAnalytics({tenantId:tenant,dateFrom:'2026-10-02',dateTo:'2026-10-03'});});
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({actualPiles:7,actualPileMeters:42,actualPilesAllTime:11,actualPileMetersAllTime:66,totalReports:1});
    } finally {
      await fixture.owner.query('DELETE FROM "Report" WHERE id=ANY($1::text[])',[[fixture.id(tenant,'Report'),second,draft]]);
      await fixture.owner.query('DELETE FROM "PileGrade" WHERE id=$1',[grade]);
      await fixture.close();
    }
  });
});

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('J8 pile journal period indexes', () => {
  it('покрывает occurredAt и NULL fallback без изменения строк и итогов', async () => {
    const ownerUrl = process.env.INTEGRATION_DATABASE_URL_OWNER;
    if (!ownerUrl) throw new Error('INTEGRATION_DATABASE_URL_OWNER is required');
    const url = new URL(ownerUrl);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/codex_test' || url.username !== 'piling') {
      throw new Error('J8 requires the disposable local codex_test owner');
    }
    const appUrlValue = process.env.DATABASE_URL || process.env.DATABASE_URL_POSTGRES;
    if (!appUrlValue) throw new Error('J8 requires the disposable application database URL');
    const appUrl = new URL(appUrlValue);
    if (appUrl.hostname !== url.hostname || appUrl.port !== url.port || appUrl.pathname !== '/codex_test' || appUrl.username !== 'pilingtrack_app') {
      throw new Error('J8 application queries must use the same disposable database as the owner');
    }
    const owner = new Client({ connectionString: url.toString() });
    const prefix = `codex-j8-${randomBytes(6).toString('hex')}`;
    const tenants = [`${prefix}-a`, `${prefix}-b`];
    const occurredIndex = 'PileWork_tenantId_occurredAt_idx';
    const receivedIndex = 'PileWork_tenantId_receivedAt_null_occurredAt_idx';
    const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
    const from = `${day(200)}T00:00:00.000Z`;
    const to = `${day(202)}T00:00:00.000Z`;
    type PlanNode = { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; Plans?: PlanNode[] };
    const nodes = (plan: PlanNode): PlanNode[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)];
    const evidence: Record<string, unknown> = { fixtureRows: 120000, tenantRows: 100000, cases: [] };
    await owner.connect();
    try {
      await owner.query('BEGIN');
      for (const tenant of tenants) {
        await owner.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,now())', [tenant]);
        await owner.query('INSERT INTO "User" (id,"tenantId",email,name,"updatedAt") VALUES ($1,$2,$3,$1,now())', [`${tenant}-user`, tenant, `${tenant}@example.invalid`]);
        await owner.query('INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","lengthMm","updatedAt") VALUES ($1,$2,$1,$1,6000,now())', [`${tenant}-grade`, tenant]);
        for (const site of tenant === tenants[0] ? [0, 1] : [0]) {
          const id = `${tenant}-site-${site}`;
          await owner.query('INSERT INTO "Site" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$1,now())', [id, tenant]);
          await owner.query('INSERT INTO "Report" (id,"reportId","tenantId","userId","siteId",date,status,"updatedAt") VALUES ($1,$1,$2,$3,$4,$5,$6,now())', [`${tenant}-report-${site}`, tenant, `${tenant}-user`, id, '2026-01-01', 'submitted']);
        }
        // 1000 days; each two-day window has both time branches and both sites.
        await owner.query(`
          INSERT INTO "PileWork" (id,"reportId","tenantId","pileGradeId",count,"occurredAt","receivedAt")
          SELECT $1 || '-pile-' || g,
            $1 || '-report-' || CASE WHEN $2::integer = 100000 THEN ((g / 1000) % 2)::text ELSE '0' END,
            $1, $1 || '-grade', 1,
            CASE WHEN g % 2 = 0 THEN '2026-01-01T00:00:00Z'::timestamptz + (g % 1000) * interval '1 day' ELSE NULL END,
            '2026-01-01T00:00:00Z'::timestamptz + (g % 1000) * interval '1 day'
          FROM generate_series(1, $2::integer) g
        `, [tenant, tenant === tenants[0] ? 100000 : 20000]);
      }
      await owner.query('COMMIT');
      await owner.query('ANALYZE "PileWork"');
      await owner.query('ANALYZE "Report"');
      await owner.query('ANALYZE "PilePassport"');
      const cases: Record<string, unknown>[] = [];
      for (const siteId of [null, `${tenants[0]}-site-0`]) {
        const expected = siteId ? 100 : 200;
        const parameters = [tenants[0], from, to, siteId];
        // Same tenant/time OR/site predicates and order as the application.
        // Related presentation SELECTs are intentionally excluded from this plan.
        const listSql = `SELECT pw.id FROM "PileWork" pw
          LEFT JOIN "Report" r ON r.id = pw."reportId"
          WHERE pw."tenantId" = $1 AND ($4::text IS NULL OR r."siteId" = $4)
            AND ((pw."occurredAt" >= $2::timestamptz AND pw."occurredAt" < $3::timestamptz)
              OR (pw."occurredAt" IS NULL AND pw."receivedAt" >= $2::timestamptz AND pw."receivedAt" < $3::timestamptz))
          ORDER BY pw."occurredAt" DESC NULLS LAST, pw."receivedAt" DESC LIMIT 501`;
        const totalsSql = `SELECT
          COALESCE(SUM(pw."count"),0)::int AS piles,
          COALESCE(SUM(pw."count") FILTER (WHERE r.status IS DISTINCT FROM $5::text),0)::int AS "draftPiles",
          COALESCE(SUM(pw."count") FILTER (WHERE p.id IS NULL),0)::int AS "withoutPassportPiles",
          COUNT(*) FILTER (WHERE p.acceptance = 'ACCEPTED')::int AS accepted,
          COUNT(*) FILTER (WHERE p.acceptance = 'NEEDS_REDRIVE')::int AS "needsRedrive",
          COUNT(*) FILTER (WHERE p.acceptance = 'PENDING')::int AS pending,
          COUNT(*)::int AS rows
          FROM "PileWork" pw
          LEFT JOIN "Report" r ON r.id = pw."reportId"
          LEFT JOIN "PilePassport" p ON p."pileWorkId" = pw.id
          WHERE pw."tenantId" = $1 AND ($4::text IS NULL OR r."siteId" = $4::text)
            AND ($6::text IS NULL OR p.acceptance::text = $6::text)
            AND ($7::text IS NULL OR p."pileNumber" ILIKE $7::text ESCAPE '\\')
            AND ((pw."occurredAt" IS NOT NULL
              AND ($2::timestamptz IS NULL OR pw."occurredAt" >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR pw."occurredAt" < $3::timestamptz))
              OR (pw."occurredAt" IS NULL
              AND ($2::timestamptz IS NULL OR pw."receivedAt" >= $2::timestamptz)
              AND ($3::timestamptz IS NULL OR pw."receivedAt" < $3::timestamptz)))`;
        const listed = await owner.query<{ id: string }>(listSql, parameters);
        const totals = await owner.query(totalsSql, [...parameters, 'submitted', null, null]);
        const plans: Record<string, unknown> = {};
        for (const [name, sql, values] of [
          ['list', listSql, parameters],
          ['totals', totalsSql, [...parameters, 'submitted', null, null]],
        ] as const) {
          const result = await owner.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, [...values]);
          plans[name] = result.rows[0]['QUERY PLAN'][0];
        }
        const page = await runWithTenantContext(async () => {
          setRequestTenantId(tenants[0]);
          return listPilePassports({ tenantId: tenants[0], siteId: siteId ?? undefined, dateFrom: day(200), dateTo: day(201), timezone: 'UTC' });
        });
        expect(listed.rows).toHaveLength(expected);
        expect(page.rows).toHaveLength(expected);
        expect(page.truncated).toBe(false);
        expect(page.rows.map(row => row.pileWorkId).sort()).toEqual(listed.rows.map(row => row.id).sort());
        expect(page.totals).toEqual(totals.rows[0]);
        expect(page.totals).toMatchObject({ piles: expected, rows: expected, draftPiles: 0, withoutPassportPiles: expected, accepted: 0, needsRedrive: 0, pending: 0 });
        const branches = await owner.query<{ fallback: number; occurred: number }>(`
          SELECT COUNT(*) FILTER (WHERE pw."occurredAt" IS NULL)::int AS fallback,
            COUNT(*) FILTER (WHERE pw."occurredAt" IS NOT NULL)::int AS occurred
          FROM "PileWork" pw WHERE pw.id = ANY($1::text[])
        `, [listed.rows.map(row => row.id)]);
        expect(branches.rows[0]).toEqual({ fallback: expected / 2, occurred: expected / 2 });
        cases.push({ siteFiltered: !!siteId, rows: expected, branches: branches.rows[0], plans });
      }
      evidence.cases = cases;
      const indexes = await owner.query<{ name: string; valid: boolean; definition: string; predicate: string | null }>(`
        SELECT c.relname AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition,
          pg_get_expr(i.indpred,i.indrelid) AS predicate
        FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        WHERE i.indrelid='"PileWork"'::regclass AND c.relname=ANY($1::text[])
      `, [[occurredIndex, receivedIndex]]);
      evidence.indexes = indexes.rows;
      mkdirSync('output/codex-t10', { recursive: true });
      writeFileSync(`output/codex-t10/j8-plans-${indexes.rows.length === 2 ? 'after' : 'before'}.json`, JSON.stringify(evidence, null, 2));
      // RED before migrations: real catalog has neither requested index.
      expect(indexes.rows.map(row => row.name).sort()).toEqual([occurredIndex, receivedIndex].sort());
      expect(indexes.rows.every(row => row.valid)).toBe(true);
      expect(indexes.rows.find(row => row.name === occurredIndex)?.definition).toContain('("tenantId", "occurredAt")');
      expect(indexes.rows.find(row => row.name === receivedIndex)?.definition).toContain('("tenantId", "receivedAt")');
      expect(indexes.rows.find(row => row.name === receivedIndex)?.predicate).toBe('("occurredAt" IS NULL)');
      for (const item of cases) {
        for (const plan of Object.values(item.plans as Record<string, { Plan: PlanNode }>)) {
          const used = nodes(plan.Plan).map(node => node['Index Name']).filter(Boolean);
          expect(used).toContain(occurredIndex);
          expect(used).toContain(receivedIndex);
        }
      }
    } finally {
      await owner.query('ROLLBACK');
      for (const tenant of tenants) {
        await owner.query('DELETE FROM "PileWork" WHERE "tenantId"=$1', [tenant]);
        await owner.query('DELETE FROM "Report" WHERE "tenantId"=$1', [tenant]);
        await owner.query('DELETE FROM "PileGrade" WHERE "tenantId"=$1', [tenant]);
        await owner.query('DELETE FROM "Site" WHERE "tenantId"=$1', [tenant]);
        await owner.query('DELETE FROM "User" WHERE "tenantId"=$1', [tenant]);
        await owner.query('DELETE FROM "Tenant" WHERE id=$1', [tenant]);
      }
      await owner.end();
    }
  }, 90000);
});
