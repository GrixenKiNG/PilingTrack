import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture } from './helpers/disposable-db';

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DATABASE_URL_APP);

describe.skipIf(!enabled)('Паспорт сваи не удаляется каскадом вместе с отчётом (ПТО, шаг 1)', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let gradeId: string;
  const [passportWorkId, plainWorkId, passportId] = ['work-passport', 'work-plain', 'passport'].map(
    (name) => `codex-restrict-${name}`,
  );

  beforeAll(async () => {
    fixture = await createFixture();
    const [withPassport, plain] = fixture.tenants;
    gradeId = `${withPassport}-grade`;
    const { owner } = fixture;
    await owner.query(
      'INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","updatedAt") VALUES ($1,$2,$3,$4,now())',
      [gradeId, withPassport, 'С-12', 'с-12'],
    );
    await owner.query(
      'INSERT INTO "PileGrade" (id,"tenantId",name,"normalizedName","updatedAt") VALUES ($1,$2,$3,$4,now())',
      [`${plain}-grade`, plain, 'С-12', 'с-12'],
    );
    await owner.query(
      'INSERT INTO "PileWork" (id,"reportId","tenantId","pileGradeId",count) VALUES ($1,$2,$3,$4,1)',
      [passportWorkId, fixture.id(withPassport, 'Report'), withPassport, gradeId],
    );
    await owner.query(
      `INSERT INTO "PilePassport" (id,"tenantId","pileWorkId","clientCommandId","pileNumber","drivenAt","recordedById","updatedAt")
       VALUES ($1,$2,$3,$4,$5,now(),$6,now())`,
      [passportId, withPassport, passportWorkId, 'cmd-1', 'С-1', fixture.id(withPassport, 'User')],
    );
    await owner.query(
      'INSERT INTO "PileWork" (id,"reportId","tenantId","pileGradeId",count) VALUES ($1,$2,$3,$4,5)',
      [plainWorkId, fixture.id(plain, 'Report'), plain, `${plain}-grade`],
    );
  });

  afterAll(async () => {
    if (!fixture) return;
    const { owner } = fixture;
    try {
      await owner.query('DELETE FROM "PilePassport" WHERE id=$1', [passportId]);
      await owner.query('DELETE FROM "PileWork" WHERE id = ANY($1)', [[passportWorkId, plainWorkId]]);
      for (const tenant of fixture.tenants) {
        await owner.query('DELETE FROM "PileGrade" WHERE id=$1', [`${tenant}-grade`]);
      }
    } finally {
      await fixture.close();
    }
  });

  it('база отказывает в удалении отчёта, у которого есть паспорт (23001, RESTRICT), и ничего не теряется', async () => {
    const { owner } = fixture;
    const reportId = fixture.id(fixture.tenants[0], 'Report');

    await expect(owner.query('DELETE FROM "Report" WHERE id=$1', [reportId])).rejects.toMatchObject({ code: '23001' });

    expect((await owner.query('SELECT 1 FROM "Report" WHERE id=$1', [reportId])).rowCount).toBe(1);
    expect((await owner.query('SELECT 1 FROM "PileWork" WHERE id=$1', [passportWorkId])).rowCount).toBe(1);
    expect((await owner.query('SELECT 1 FROM "PilePassport" WHERE id=$1', [passportId])).rowCount).toBe(1);
  });

  it('база отказывает и в прямом удалении записи выработки с паспортом', async () => {
    await expect(fixture.owner.query('DELETE FROM "PileWork" WHERE id=$1', [passportWorkId])).rejects.toMatchObject({
      code: '23001',
    });
  });

  it('отчёт без паспортов по-прежнему удаляется вместе с выработкой', async () => {
    const { owner } = fixture;
    const reportId = fixture.id(fixture.tenants[1], 'Report');

    await owner.query('DELETE FROM "Report" WHERE id=$1', [reportId]);

    expect((await owner.query('SELECT 1 FROM "PileWork" WHERE id=$1', [plainWorkId])).rowCount).toBe(0);
  });
});
