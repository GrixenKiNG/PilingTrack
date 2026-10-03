// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFixture } from './helpers/disposable-db';
import { getSiteAnalytics } from '@/modules/analytics';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';

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
