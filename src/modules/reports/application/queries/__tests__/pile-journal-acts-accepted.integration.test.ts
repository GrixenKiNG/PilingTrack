// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/postgres-client/client';
import { createFixture } from '../../../../../../tests/integration/helpers/disposable-db';
import { firstSheet } from './pile-journal-xlsx.fixture';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));
vi.mock('@/modules/settings', () => ({ getSettings: async () => ({ timezone: 'Europe/Moscow', companyName: 'Испытательная организация', inn: '7700000000' }) }));

/** АОСР и АООК освидетельствуют только принятые сваи: копёр, молот и даты — тоже только их. */
describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('ПТО: шапка АОСР и АООК по принятым сваям на одноразовой базе', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let tenant: string;
  let site: string;
  const insert = async (table: string, values: Record<string, unknown>) => {
    const columns = Object.keys(values);
    await fixture.owner.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(values));
  };
  const now = new Date('2026-10-30T00:00:00Z');
  const seedPile = async (key: string, opts: { equipment: string; report: string; at: Date; acceptance: string; hammer: string }) => {
    await insert('PileWork', { id: `${tenant}-w-${key}`, tenantId: tenant, reportId: `${tenant}-r-${opts.report}`, pileGradeId: `${tenant}-grade`, count: 1, occurredAt: opts.at, receivedAt: now });
    await insert('PilePassport', { id: `${tenant}-p-${key}`, tenantId: tenant, pileWorkId: `${tenant}-w-${key}`, clientCommandId: `${tenant}-cmd-${key}`, pileNumber: `ACT-${key}`, acceptance: opts.acceptance, hammerType: opts.hammer, recordedById: fixture.id(tenant, 'User'), drivenAt: opts.at, updatedAt: now });
  };
  beforeAll(async () => {
    fixture = await createFixture();
    tenant = fixture.tenants[0];
    site = fixture.id(tenant, 'Site');
    await insert('PileGrade', { id: `${tenant}-grade`, tenantId: tenant, name: `Марка-${tenant}`, normalizedName: tenant, lengthMm: 12000, updatedAt: now });
    for (const [key, name, date] of [['bauer', 'Bauer RTG RM20', '2026-10-29'], ['banut', 'Banut 655', '2026-08-28']]) {
      await insert('Equipment', { id: `${tenant}-e-${key}`, tenantId: tenant, name, updatedAt: now });
      await insert('Report', { id: `${tenant}-r-${key}`, tenantId: tenant, reportId: `${tenant}-r-${key}`, userId: fixture.id(tenant, 'User'), siteId: site, equipmentId: `${tenant}-e-${key}`, date, updatedAt: now });
    }
    // Принята одна свая — на Bauer 29.10; остальные — на другой установке и в другие дни.
    await seedPile('1', { equipment: 'bauer', report: 'bauer', at: new Date('2026-10-29T08:00:00Z'), acceptance: 'ACCEPTED', hammer: 'PVE 7NL' });
    await seedPile('2', { equipment: 'banut', report: 'banut', at: new Date('2026-08-28T08:00:00Z'), acceptance: 'PENDING', hammer: 'PVE 50PR' });
    await seedPile('3', { equipment: 'banut', report: 'banut', at: new Date('2026-08-30T08:00:00Z'), acceptance: 'NEEDS_REDRIVE', hammer: 'PVE 50PR' });
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.INTEGRATION_DATABASE_URL_APP, options: `-c app.current_tenant=${tenant}`, max: 2 }) });
  }, 30000);
  afterAll(async () => {
    await state.db?.$disconnect();
    if (!fixture) return;
    try {
      await fixture.owner.query('DELETE FROM "PilePassport" WHERE "tenantId"=$1', [tenant]);
      await fixture.owner.query('DELETE FROM "PileWork" WHERE "tenantId"=$1', [tenant]);
      await fixture.owner.query('DELETE FROM "PileGrade" WHERE "tenantId"=$1', [tenant]);
      await fixture.owner.query('DELETE FROM "Report" WHERE "tenantId"=$1 AND id LIKE $2', [tenant, `${tenant}-r-%`]);
      await fixture.owner.query('DELETE FROM "Equipment" WHERE "tenantId"=$1 AND id LIKE $2', [tenant, `${tenant}-e-%`]);
    } finally { await fixture.close(); }
  });

  const filters = () => ({ tenantId: tenant, siteId: site, pileNumber: 'ACT-' });
  /** Установка, молот и день принятой сваи — прямо из SQL, не из кода продукта. */
  const acceptedFacts = async () => {
    const { rows } = await fixture.owner.query(
      `SELECT e.name AS equipment, p."hammerType" AS hammer,
              to_char(MIN(w."occurredAt") AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY') AS first_day,
              to_char(MAX(w."occurredAt") AT TIME ZONE 'Europe/Moscow', 'DD.MM.YYYY') AS last_day
         FROM "PileWork" w JOIN "PilePassport" p ON p."pileWorkId"=w.id
         JOIN "Report" r ON r.id=w."reportId" JOIN "Equipment" e ON e.id=r."equipmentId"
        WHERE w."tenantId"=$1 AND p."pileNumber" LIKE 'ACT-%' AND p.acceptance='ACCEPTED'
        GROUP BY e.name, p."hammerType"`, [tenant]);
    expect(rows).toHaveLength(1);
    return rows[0] as { equipment: string; hammer: string; first_day: string; last_day: string };
  };

  it('АОСР: копёр, молот и даты — только принятой сваи', async () => {
    const { exportPileAosrXlsx } = await import('../pile-journal-aosr');
    const facts = await acceptedFacts();
    expect(facts).toMatchObject({ equipment: 'Bauer RTG RM20', hammer: 'PVE 7NL', first_day: '29.10.2026', last_day: '29.10.2026' });
    const sheet = firstSheet(await exportPileAosrXlsx(filters()));
    expect(sheet.find((r) => String(r[1] ?? '').startsWith('Копёр:'))?.[1]).toBe(`Копёр: ${facts.equipment}; молот: ${facts.hammer}`);
    expect(sheet.find((r) => r[0] === '5. Даты')).toEqual(['5. Даты', `начала работ: ${facts.first_day}`, `окончания работ: ${facts.last_day}`]);
    const text = JSON.stringify(sheet);
    for (const foreign of ['Banut 655', 'PVE 50PR', '28.08.2026', '30.08.2026']) expect(text).not.toContain(foreign);
    expect(text).toContain('в акт не включено: 2');
  });

  it('АООК: даты — только принятой сваи', async () => {
    const { exportPileAookXlsx } = await import('../pile-journal-aook');
    const facts = await acceptedFacts();
    const sheet = firstSheet(await exportPileAookXlsx(filters()));
    expect(sheet.find((r) => r[0] === '7. Даты')).toEqual(['7. Даты', `начала работ: ${facts.first_day}`, `окончания работ: ${facts.last_day}`]);
    const text = JSON.stringify(sheet);
    for (const foreign of ['28.08.2026', '30.08.2026']) expect(text).not.toContain(foreign);
  });
});
