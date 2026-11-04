// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/postgres-client/client';
import { createFixture } from '../../../../../../tests/integration/helpers/disposable-db';
import { firstSheet } from './pile-journal-xlsx.fixture';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));
vi.mock('@/modules/settings', () => ({ getSettings: async () => ({ timezone: 'Europe/Moscow', companyName: 'Испытательная организация', inn: '7700000000' }) }));

/** Выгрузки читаем из готового .xlsx и сверяем с SQL, не с кодом продукта. */
describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('ПТО: порядок свай в формах 4.1 и 2.5 на одноразовой базе', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let tenant: string;
  let site: string;
  const created = { passports: [] as string[], works: [] as string[] };
  const insert = async (table: string, values: Record<string, unknown>) => {
    const columns = Object.keys(values);
    await fixture.owner.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  };
  /** Одна свая с паспортом: запись выработки + паспорт, дата забивки — `occurredAt` (или только `receivedAt`). */
  const seedPile = async (key: string, opts: { number: string; occurredAt: Date | null; receivedAt?: Date; acceptance?: string }) => {
    const at = new Date('2026-10-30T00:00:00Z');
    await insert('PileWork', { id: `${tenant}-w-${key}`, tenantId: tenant, reportId: fixture.id(tenant, 'Report'), pileGradeId: `${tenant}-grade`, count: 1, occurredAt: opts.occurredAt, receivedAt: opts.receivedAt ?? at });
    await insert('PilePassport', { id: `${tenant}-p-${key}`, tenantId: tenant, pileWorkId: `${tenant}-w-${key}`, clientCommandId: `${tenant}-cmd-${key}`, pileNumber: opts.number, acceptance: opts.acceptance ?? 'PENDING', recordedById: fixture.id(tenant, 'User'), drivenAt: opts.occurredAt ?? opts.receivedAt ?? at, updatedAt: at });
    created.works.push(`${tenant}-w-${key}`);
    created.passports.push(`${tenant}-p-${key}`);
  };
  beforeAll(async () => {
    fixture = await createFixture();
    tenant = fixture.tenants[0];
    site = fixture.id(tenant, 'Site');
    const at = new Date('2026-10-30T00:00:00Z');
    await insert('PileGrade', { id: `${tenant}-grade`, tenantId: tenant, name: `Марка-${tenant}`, normalizedName: tenant, lengthMm: 12000, updatedAt: at });
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.INTEGRATION_DATABASE_URL_APP, options: `-c app.current_tenant=${tenant}`, max: 2 }) });
  }, 30000);
  afterAll(async () => {
    await state.db?.$disconnect();
    if (!fixture) return;
    try {
      await fixture.owner.query('DELETE FROM "PilePassport" WHERE "tenantId"=$1', [tenant]);
      await fixture.owner.query('DELETE FROM "PileWork" WHERE "tenantId"=$1', [tenant]);
      await fixture.owner.query('DELETE FROM "PileGrade" WHERE "tenantId"=$1', [tenant]);
    } finally { await fixture.close(); }
  });

  describe('форма 4.1, форма 2.5 и срез по пределу', () => {
    // Вставляем «вперемешку»: порядок в базе не должен влиять на печать.
    beforeAll(async () => {
      await seedPile('3', { number: 'ORD-3', occurredAt: new Date('2026-10-20T10:00:00Z') });
      await seedPile('2', { number: 'ORD-2', occurredAt: new Date('2026-10-18T14:00:00Z') });
      await seedPile('1', { number: 'ORD-1', occurredAt: new Date('2026-10-18T09:00:00Z') });
      // Старая запись без occurredAt: дата забивки — момент записи.
      await seedPile('4', { number: 'ORD-4', occurredAt: null, receivedAt: new Date('2026-10-25T08:00:00Z') });
    });
    const filters = () => ({ tenantId: tenant, siteId: site, pileNumber: 'ORD-' });
    /** Независимый порядок: день по Москве, затем номер сваи — прямо в SQL. */
    const sqlOrder = async () => (await fixture.owner.query(
      `SELECT p."pileNumber" AS n FROM "PileWork" w JOIN "PilePassport" p ON p."pileWorkId"=w.id
       WHERE w."tenantId"=$1 AND p."pileNumber" LIKE 'ORD-%'
       ORDER BY (COALESCE(w."occurredAt", w."receivedAt") AT TIME ZONE 'Europe/Moscow')::date, p."pileNumber"`, [tenant])).rows.map((r) => r.n as string);

    it('форма 4.1 печатает от ранней забивки к поздней', async () => {
      const { exportPileJournalForm41Xlsx } = await import('../pile-journal-form41');
      const printed = firstSheet(await exportPileJournalForm41Xlsx(filters())).map((r) => r[1]).filter((v) => typeof v === 'string' && v.startsWith('ORD-'));
      expect(await sqlOrder()).toEqual(['ORD-1', 'ORD-2', 'ORD-3', 'ORD-4']);
      expect(printed).toEqual(await sqlOrder());
    });

    it('форма 2.5 печатает так же, «с № … по №» — первая и последняя', async () => {
      const { exportPileSvodXlsx } = await import('../pile-journal-svod');
      const sheet = firstSheet(await exportPileSvodXlsx(filters()));
      expect(sheet.filter((r) => typeof r[0] === 'number' && typeof r[1] === 'string' && r[1].startsWith('ORD-')).map((r) => r[1])).toEqual(await sqlOrder());
      const order = await sqlOrder();
      expect(sheet.find((r) => r[0] === '(с №')).toEqual(['(с №', order[0], 'по №', order[order.length - 1], ')']);
    });

    it('экран остаётся «новые сверху» (запись без occurredAt — в конце), срез по пределу отбрасывает самые поздние', async () => {
      const { listPilePassports } = await import('../pile-journal-list');
      const screen = await listPilePassports(filters());
      expect(screen.rows.map((r) => r.pileNumber)).toEqual(['ORD-3', 'ORD-2', 'ORD-1', 'ORD-4']);
      const cut = await listPilePassports({ ...filters(), order: 'asc', limit: 2 });
      expect(cut.truncated).toBe(true);
      expect(cut.rows.map((r) => r.pileNumber)).toEqual(['ORD-1', 'ORD-2']);
    });
  });
});
