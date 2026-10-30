// @vitest-environment node
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/postgres-client/client';
import { createFixture, inTenant } from '../../../../../../tests/integration/helpers/disposable-db';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));
vi.mock('@/modules/settings', () => ({ getSettings: async () => ({ timezone: 'Europe/Moscow', companyName: 'Испытательная организация '.repeat(30), inn: '0000000000' }) }));

// Read the ZIP central directory independently of the product writer.
function parts(buffer: Buffer): Map<string, string> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const files = new Map<string, string>();
  let cursor = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    const local = buffer.readUInt32LE(cursor + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString());
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return files;
}

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('ПТО: независимые SQL и RLS одноразовой базы', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let tenant: string;
  let foreign: string;
  let list: typeof import('../pile-journal-list').listPilePassports;
  let exporters: Array<(filters: { tenantId: string; siteId?: string }) => Promise<Buffer>>;
  const at = new Date('2026-10-28T10:00:00Z');
  const insert = async (table: string, values: Record<string, unknown>) => {
    const columns = Object.keys(values);
    await fixture.owner.query(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  };
  beforeAll(async () => {
    fixture = await createFixture();
    [tenant, foreign] = fixture.tenants;
    for (const t of fixture.tenants) {
      await insert('PileGrade', { id: `${t}-grade`, tenantId: t, name: `Марка-${t}`, normalizedName: t, lengthMm: 12000, updatedAt: at });
      for (let field = 0; field < 2; field++) {
        await insert('PileField', { id: `${t}-field${field}`, name: `Поле ${field}`, siteId: fixture.id(t, 'Site'), updatedAt: at });
        await insert('Cluster', { id: `${t}-cluster${field}`, name: `Куст ${field}`, fieldId: `${t}-field${field}`, updatedAt: at });
        await insert('Picket', { id: `${t}-picket${field}`, name: `Пикет ${field}`, clusterId: `${t}-cluster${field}`, updatedAt: at });
      }
      for (let i = 0; i < 4; i++) {
        await insert('PileWork', { id: `${t}-work${i}`, tenantId: t, reportId: fixture.id(t, 'Report'), pileGradeId: `${t}-grade`, count: i === 3 ? 5 : 1, picketId: `${t}-picket${i % 2}`, occurredAt: at });
        if (i === 3) continue;
        await insert('PilePassport', { id: `${t}-passport${i}`, tenantId: t, pileWorkId: `${t}-work${i}`, clientCommandId: `${t}-cmd${i}`, pileNumber: `PILE-${i}`, acceptance: i === 0 ? 'ACCEPTED' : i === 1 ? 'PENDING' : 'NEEDS_REDRIVE', recordedById: fixture.id(t, 'User'), drivenAt: at, updatedAt: at });
        for (let ordinal = 1; ordinal <= 2; ordinal++) {
          await insert('PileJoint', { id: `${t}-joint${i}-${ordinal}`, tenantId: t, passportId: `${t}-passport${i}`, ordinal, weldedAt: at, welderName: 'Сварщик', electrode: 'Электроды', anticorrosionMaterial: ordinal === 1 ? 'Материал' : null, anticorrosionAt: ordinal === 1 ? at : null });
        }
      }
    }
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.INTEGRATION_DATABASE_URL_APP, options: `-c app.current_tenant=${tenant}`, max: 2 }) });
    ({ listPilePassports: list } = await import('../pile-journal-list'));
    const { exportPileJournalForm41Xlsx } = await import('../pile-journal-form41');
    const { exportPileSvodXlsx } = await import('../pile-journal-svod');
    const { exportPileAosrXlsx } = await import('../pile-journal-aosr');
    const { exportPileAookXlsx } = await import('../pile-journal-aook');
    const { exportPileJointActXlsx } = await import('../pile-journal-joint-acts');
    exporters = [exportPileJournalForm41Xlsx, exportPileSvodXlsx, exportPileAosrXlsx, exportPileAookXlsx, f => exportPileJointActXlsx(f, 'WELD'), f => exportPileJointActXlsx(f, 'ANTICORROSION')];
  }, 30000);
  afterAll(async () => {
    await state.db?.$disconnect();
    if (!fixture) return;
    try {
      for (const t of fixture.tenants) {
        for (const table of ['PileJoint', 'PilePassport', 'PileWork', 'PileGrade']) await fixture.owner.query(`DELETE FROM "${table}" WHERE "tenantId"=$1`, [t]);
        await fixture.owner.query('DELETE FROM "PileField" WHERE "siteId"=$1', [fixture.id(t, 'Site')]);
      }
    } finally { await fixture.close(); }
  });

  it('использует pilingtrack_app без superuser и bypassrls; SQL совпадает с журналом', async () => {
    if (!state.db) throw new Error('Disposable Prisma client was not initialized');
    const role = await state.db.$queryRaw<Array<{ name: string; rolsuper: boolean; rolbypassrls: boolean }>>`SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual([{ name: 'pilingtrack_app', rolsuper: false, rolbypassrls: false }]);
    const sql = await fixture.owner.query('SELECT SUM("count")::int AS piles, COUNT(*)::int AS rows FROM "PileWork" WHERE "tenantId"=$1', [tenant]);
    const page = await list({ tenantId: tenant });
    expect(page.rows).toHaveLength(sql.rows[0].rows);
    expect(page.rows.reduce((n, r) => n + r.count, 0)).toBe(sql.rows[0].piles);
    expect(page.rows.filter(r => r.hasPassport)).toHaveLength(3);
    expect(page.rows.filter(r => r.acceptance === 'ACCEPTED')).toHaveLength(1);
    expect(page.rows.every(r => r.pileGradeName === `Марка-${tenant}`)).toBe(true);
  });

  it('RLS скрывает чужие стыки и запрещает вставку с чужим tenantId', async () => {
    await inTenant(fixture.app, tenant, async () => {
      expect((await fixture.app.query('SELECT id FROM "PileJoint" WHERE "passportId"=$1', [`${foreign}-passport0`])).rows).toEqual([]);
      await expect(fixture.app.query('INSERT INTO "PileJoint" (id,"tenantId","passportId",ordinal,"weldedAt","welderName",electrode) VALUES ($1,$2,$3,99,now(),$4,$5)', ['foreign-insert', foreign, `${foreign}-passport0`, 'X', 'X'])).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('чужой объект даёт пустой список и все шесть выгрузок без чужих свай', async () => {
    const filters = { tenantId: tenant, siteId: fixture.id(foreign, 'Site') };
    expect((await list(filters)).rows).toEqual([]);
    for (const exporter of exporters) {
      const archive = parts(await exporter(filters));
      expect(archive.get('xl/worksheets/sheet1.xml')).not.toContain(`Марка-${foreign}`);
      expect(archive.get('xl/worksheets/sheet1.xml')).not.toContain('PILE-0');
    }
  });

  it('все формы создают XLSX с листом; акты включают только принятые сваи и считают стыки по SQL', async () => {
    const sql = await fixture.owner.query('SELECT COUNT(*)::int AS total, COUNT(j."anticorrosionAt")::int AS coated FROM "PileJoint" j JOIN "PilePassport" p ON p.id=j."passportId" WHERE j."tenantId"=$1 AND p.acceptance=\'ACCEPTED\'', [tenant]);
    for (const [index, exporter] of exporters.entries()) {
      const archive = parts(await exporter({ tenantId: tenant }));
      expect(archive.has('[Content_Types].xml')).toBe(true);
      expect(archive.get('xl/workbook.xml')).toContain('<sheet ');
      const xml = archive.get('xl/worksheets/sheet1.xml');
      if (!xml) throw new Error('Missing first XLSX worksheet');
      expect(xml).toContain('<worksheet');
      expect(xml).toContain('Испытательная организация');
      if (index < 2) {
        expect(xml).toContain('PILE-0');
        expect(xml).toContain('PILE-1');
        expect(xml).toContain('<v>');
        const omitted = await fixture.owner.query('SELECT SUM(pw.count)::int AS count FROM "PileWork" pw LEFT JOIN "PilePassport" p ON p."pileWorkId"=pw.id WHERE pw."tenantId"=$1 AND p.id IS NULL', [tenant]);
        expect(xml).toContain(`Свай без паспорта ${index === 0 ? 'в форму' : 'в ведомость'} не включено: ${omitted.rows[0].count}`);
      } else if (index >= 4) {
        expect(xml).toContain('PILE-0');
        expect(xml).not.toContain('PILE-1, стык');
        expect(xml).not.toContain('PILE-2, стык');
        expect(xml).toContain(`Итого стыков: ${index === 4 ? sql.rows[0].total : sql.rows[0].coated} шт.`);
        expect(xml).toContain('в акт не включено: 2');
      } else {
        expect(xml).toContain('длина 12 м — 1 шт.');
        expect(xml).toContain('в акт не включено: 2');
      }
    }
  });
});
