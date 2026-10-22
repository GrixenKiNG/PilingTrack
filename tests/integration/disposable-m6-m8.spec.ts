// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, utimes, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { createFixture } from './helpers/disposable-db';

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DATABASE_URL_APP);
const workspace = process.cwd();
// Real db / RLS / projections / delivery; only Telegram HTTP is substituted.
describe.skipIf(!enabled)('M6–M8 on disposable migrated Postgres', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let db: typeof import('@/lib/db').db;
  let tenant: string;
  let site: string;
  let report: string;
  let grade: string;
  let files: string | undefined;
  const inContext = async <T>(work: () => Promise<T>) => {
    const { runWithTenantContext, setRequestTenantId } = await import('@/core/security/tenant-context');
    return runWithTenantContext(async () => { setRequestTenantId(tenant); return await work(); });
  };
  beforeAll(async () => {
    fixture = await createFixture(); tenant = fixture.tenants[0];
    site = fixture.id(tenant, 'Site'); report = fixture.id(tenant, 'Report'); grade = tenant + '-grade';
    vi.stubEnv('DATABASE_URL', process.env.INTEGRATION_DATABASE_URL_APP ?? '');
    vi.stubEnv('DATABASE_URL_POSTGRES', process.env.INTEGRATION_DATABASE_URL_APP ?? '');
    vi.stubEnv('DEFAULT_TENANT_ID', tenant);
    db = (await import('@/lib/db')).db;
    expect((await inContext(() => db.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`))[0].current_user).toBe('pilingtrack_app');
  });
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (files) {
      const base = resolve(workspace, '.tmp'); const target = resolve(files);
      if (!target.startsWith(base + sep) || relative(base, target).startsWith('..')) throw new Error('unsafe fixture cleanup');
      await rm(target, { recursive: true, force: true }); files = undefined;
    }
  });
  afterAll(async () => {
    await db?.$disconnect(); vi.unstubAllEnvs();
    if (fixture) {
      await fixture.owner.query('DELETE FROM "DeadLetterQueue" WHERE "tenantId" = $1', [tenant]);
      await fixture.owner.query('DELETE FROM "OutboxEvent" WHERE "tenantId" = $1', [tenant]);
      await fixture.owner.query('DELETE FROM "TelegramConfig" WHERE "tenantId" = $1', [tenant]);
      await fixture.owner.query('DELETE FROM "Media" WHERE "tenantId" = $1', [tenant]);
      await fixture.owner.query('DELETE FROM "SiteDailySummary" WHERE "siteId" = $1', [site]);
      await fixture.owner.query('DELETE FROM "PileWork" WHERE "reportId" = $1', [report]);
      await fixture.owner.query('DELETE FROM "PileGrade" WHERE id = $1', [grade]);
      await fixture.close();
    }
  });

  it('M6: draft excluded from KPI/live projection/rebuild; submission and rebuild agree', async () => {
    const { recomputeSiteDailySummary } = await import('@/modules/reports/server');
    const { rebuildSiteDailySummary } = await import('@/modules/reports/application/projections/rebuild');
    const { getFleetSnapshot } = await import('@/modules/monitoring/application/queries/fleet-monitoring.service');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
    await fixture.owner.query('INSERT INTO "PileGrade" (id, "tenantId", name, "normalizedName", "lengthMm", "updatedAt") VALUES ($1,$2,$3,$3,6000,now())', [grade, tenant, grade]);
    await fixture.owner.query('INSERT INTO "PileWork" (id,"tenantId","reportId","pileGradeId",count) VALUES ($1,$2,$3,$4,3)', [tenant + '-pile', tenant, report, grade]);
    await fixture.owner.query('UPDATE "Report" SET date=$1,"equipmentId"=$2,status=$3 WHERE id=$4', [today, fixture.id(tenant, 'Equipment'), 'draft', report]);
    const summary = () => fixture.owner.query('SELECT "totalPiles","totalDrilling","totalDowntime","reportCount" FROM "SiteDailySummary" WHERE "siteId"=$1 AND date=$2', [site, today]);
    await inContext(() => recomputeSiteDailySummary(site, today));
    expect((await summary()).rows).toEqual([]);
    expect((await inContext(() => getFleetSnapshot({ tenantId: tenant }))).totals.pilesToday).toBe(0);
    await rebuildSiteDailySummary(); expect((await summary()).rows).toEqual([]);
    // Submit persisted source and run the same recompute as REPORT_SUBMITTED.
    await inContext(() => db.report.update({ where: { id: report }, data: { status: 'submitted', submittedAt: new Date() } }));
    await inContext(() => recomputeSiteDailySummary(site, today));
    const live = (await summary()).rows;
    expect(live).toEqual([{ totalPiles: 3, totalDrilling: 0, totalDowntime: 0, reportCount: 1 }]);
    const kpi = await inContext(() => getFleetSnapshot({ tenantId: tenant }));
    expect(kpi.totals).toMatchObject({ pilesToday: 3, pileMetersToday: 18, operatorsOnShiftToday: 1 });
    await rebuildSiteDailySummary(); expect((await summary()).rows).toEqual(live);
    expect((await inContext(() => getFleetSnapshot({ tenantId: tenant }))).totals).toEqual(kpi.totals);
  });

  it('journal header covers all 501 rows and export status filters reach PostgreSQL', async () => {
    const {listPilePassports, pileJournalHeader} = await import('@/modules/reports/application/queries/pile-passport.service');
    const {exportReportsCsv} = await import('@/modules/reports/application/queries/report-export.service');
    const extraReport = tenant + '-scope-report';
    const extraSite = tenant + '-scope-site';
    try {
      await fixture.owner.query('INSERT INTO "Site" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,$3,now())', [extraSite, tenant, 'Other scope site']);
      await fixture.owner.query('INSERT INTO "Report" (id,"tenantId","reportId","userId","siteId",date,status,"updatedAt") VALUES ($1,$2,$1,$3,$4,$5,$6,now())', [extraReport, tenant, fixture.id(tenant, 'User'), extraSite, '2026-09-02', 'draft']);
      await fixture.owner.query('INSERT INTO "PileWork" (id,"tenantId","reportId","pileGradeId",count,"occurredAt") SELECT $1 || n,$2,CASE WHEN n=501 THEN $3 ELSE $4 END,$5,1,CASE WHEN n=501 THEN $6::timestamptz ELSE $7::timestamptz END FROM generate_series(1,501) n', [tenant + '-scope-', tenant, extraReport, report, grade, '2026-09-01T21:30:00Z', '2026-09-29T21:30:00Z']);
      const page = await inContext(() => listPilePassports({tenantId: tenant, dateFrom: '2026-09-01', dateTo: '2026-09-30', timezone: 'Europe/Moscow'}));
      expect(page.rows).toHaveLength(500);
      expect(page.truncated).toBe(true);
      const header = pileJournalHeader(page.rows, page.totals, 'Europe/Moscow');
      expect(header.siteNames.sort()).toEqual(['Disposable site', 'Other scope site']);
      expect(header).toMatchObject({dateFrom: '02.09.2026', dateTo: '30.09.2026', rowsTotal: 501, pilesTotal: 501});
      const submitted = await inContext(() => exportReportsCsv({tenantId: tenant, filter: 'submitted'}));
      const drafts = await inContext(() => exportReportsCsv({tenantId: tenant, filter: 'drafts'}));
      expect(submitted).toContain(report);
      expect(submitted).not.toContain(extraReport);
      expect(drafts).toContain(extraReport);
      expect(drafts).not.toContain(`"${report}"`);
    } finally {
      await fixture.owner.query('DELETE FROM "PileWork" WHERE "tenantId"=$1 AND id LIKE $2', [tenant, tenant + '-scope-%']);
      await fixture.owner.query('DELETE FROM "Report" WHERE id=$1', [extraReport]);
      await fixture.owner.query('DELETE FROM "Site" WHERE id=$1', [extraSite]);
    }
  });

  it('не засчитывает инструктаж до подписи работника в личном допуске и общей сводке', async () => {
    const {querySelfSafetyView} = await import('@/modules/safety/application/self-clearance-query');
    const {querySafetyClearanceOverview} = await import('@/modules/safety/application/clearance-overview-query');
    const userId = fixture.id(tenant, 'User');
    const id = fixture.id(tenant, 'BriefingRecord');
    const view = () => inContext(() => querySelfSafetyView({tenantId: tenant, userId}));
    const overview = () => inContext(() => querySafetyClearanceOverview({tenantId: tenant, mayReadAllDocuments: true}));
    const before = await view();
    const instruction = before.briefings.required[0];
    expect(instruction).toBeDefined();
    await fixture.owner.query('UPDATE "BriefingRecord" SET "documentCode"=$1,"documentVersion"=$2,"instructorId"=$3,"instructorSignedAt"=now(),"employeeSignedAt"=NULL WHERE id=$4', [instruction.code, instruction.version, userId, id]);
    const pending = await view();
    expect(pending.briefings.pending).toHaveLength(before.briefings.pending.length);
    expect(pending.history.find(row => row.id === id)?.awaitingEmployeeSignature).toBe(true);
    const pendingOverview = await overview();
    await fixture.owner.query('UPDATE "BriefingRecord" SET "employeeSignedAt"=now() WHERE id=$1', [id]);
    expect((await view()).briefings.pending).toHaveLength(before.briefings.pending.length - 1);
    const signedOverview = await overview();
    expect(signedOverview.rows.find(row => row.userId === userId)?.pendingInstructions)
      .toHaveLength((pendingOverview.rows.find(row => row.userId === userId)?.pendingInstructions.length ?? 0) - 1);
  });

  it('M7: partial receipts survive a disconnected client/module restart; retry sends only B', async () => {
    const eventId = tenant + '-delivery';
    const alert = { severity: 'high', message: 'Disposable Telegram proof' };
    for (const chat of ['A', 'B']) {
      await fixture.owner.query('INSERT INTO "TelegramConfig" (id,"tenantId",label,"botToken","chatId","updatedAt") VALUES ($1,$2,$3,$4,$3,now())', [tenant + '-chat-' + chat, tenant, chat, 'codex-fake-token']);
    }
    await fixture.owner.query('INSERT INTO "OutboxEvent" (id,"tenantId",type,"aggregateType","aggregateId",payload,projected) VALUES ($1,$2,$3,$4,$1,$5,true)', [eventId, tenant, 'NotificationDeliveryRequested', 'Notification', JSON.stringify(alert)]);
    vi.stubEnv('TELEGRAM_API_BASE', 'http://telegram.invalid');
    const sent: string[] = []; let failed = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toContain('http://telegram.invalid/');
      const chat = (JSON.parse(String(options.body)) as { chat_id: string }).chat_id; sent.push(chat);
      if (chat === 'B' && !failed) { failed = true; throw new Error('simulated network timeout'); }
      return { ok: true, json: async () => ({ ok: true }) };
    }));
    const { deliverQueuedAlert } = await import('@/modules/notifications');
    await expect(inContext(() => deliverQueuedAlert({ id: eventId, tenantId: tenant, data: alert }))).rejects.toThrow('retained for retry');
    const persisted = await fixture.owner.query('SELECT payload,published FROM "OutboxEvent" WHERE id=$1', [eventId]);
    expect(persisted.rows[0]).toMatchObject({ payload: { telegramDeliveredChatIds: ['A'] }, published: false });
    expect(sent).toEqual(['A', 'B']); sent.length = 0;
    await db.$disconnect(); delete (globalThis as { prisma?: unknown }).prisma; vi.resetModules();
    db = (await import('@/lib/db')).db;
    const restarted = await import('@/modules/notifications');
    await inContext(() => restarted.deliverQueuedAlert({ id: eventId, tenantId: tenant, data: persisted.rows[0].payload }));
    expect(sent).toEqual(['B']);
    const complete = await fixture.owner.query('SELECT payload,published FROM "OutboxEvent" WHERE id=$1', [eventId]);
    expect(complete.rows[0]).toMatchObject({ payload: { telegramDeliveredChatIds: ['A', 'B'] }, published: true });
    sent.length = 0;
    await inContext(() => restarted.deliverQueuedAlert({ id: eventId, tenantId: tenant, data: alert })); expect(sent).toEqual([]);
  });

  it('F3: real RLS config marks permanent B disabled while outbox publishes delivery to A', async () => {
    const eventId = tenant + '-permanent-delivery';
    const alert = { severity: 'high', message: 'Permanent chat proof' };
    for (const chat of ['A', 'B']) {
      await fixture.owner.query('INSERT INTO "TelegramConfig" (id,"tenantId",label,"botToken","chatId","updatedAt") VALUES ($1,$2,$3,$4,$3,now()) ON CONFLICT (id) DO UPDATE SET enabled=true,label=EXCLUDED.label,"updatedAt"=now()', [tenant + '-chat-' + chat, tenant, chat, 'codex-fake-token']);
    }
    await fixture.owner.query('INSERT INTO "OutboxEvent" (id,"tenantId",type,"aggregateType","aggregateId",payload,projected) VALUES ($1,$2,$3,$4,$1,$5,true)', [eventId, tenant, 'NotificationDeliveryRequested', 'Notification', JSON.stringify(alert)]);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const chat = JSON.parse(String(options.body)).chat_id;
      return chat === 'B'
        ? { ok: false, status: 400, text: async () => '{"description":"Bad Request: chat not found"}' }
        : { ok: true, json: async () => ({ ok: true }) };
    }));
    const { deliverQueuedAlert } = await import('@/modules/notifications');
    const deliver = () => inContext(() => deliverQueuedAlert({ id: eventId, tenantId: tenant, data: alert }));
    // Решение владельца 17.10.2026: канал отключается после трёх отказов «навсегда» подряд.
    // Первые два — обычный сбой: доставка в A уже сохранена, outbox повторит попытку.
    await expect(deliver()).rejects.toThrow('retained for retry');
    await expect(deliver()).rejects.toThrow('retained for retry');
    await deliver();
    expect((await fixture.owner.query('SELECT payload,published FROM "OutboxEvent" WHERE id=$1', [eventId])).rows[0])
      .toMatchObject({ published: true, payload: { telegramDeliveredChatIds: ['A'] } });
    expect((await fixture.owner.query('SELECT enabled,label FROM "TelegramConfig" WHERE id=$1 AND "tenantId"=$2', [tenant + '-chat-B', tenant])).rows[0])
      .toMatchObject({ enabled: false, label: expect.stringContaining('Чат не найден') });
  });
  it('F2: persisted DLQ then recovered webhook creates a fresh published attempt', async () => {
    for (const chat of ['A', 'B']) {
      await fixture.owner.query('INSERT INTO "TelegramConfig" (id,"tenantId",label,"botToken","chatId","updatedAt") VALUES ($1,$2,$3,$4,$3,now()) ON CONFLICT (id) DO UPDATE SET enabled=true,label=EXCLUDED.label,"updatedAt"=now()', [tenant + '-chat-' + chat, tenant, chat, 'codex-fake-token']);
    }
    const { POST } = await import('@/app/api/alerts/webhook/route');
    const { NextRequest } = await import('next/server');
    const { moveToDlq } = await import('@/core/outbox/dead-letter-queue');
    const token = randomUUID(); vi.stubEnv('ALERTMANAGER_WEBHOOK_TOKEN', token);
    const ruleId = tenant + '-dlq-proof';
    const request = () => new NextRequest('http://localhost/api/alerts/webhook', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ alerts: [{ status: 'firing', labels: { alertname: ruleId, severity: 'critical' }, annotations: { summary: 'Own DLQ test' }, startsAt: '2026-10-01T00:00:00Z' }] }),
    });
    let recovered = false; const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      if (!recovered) throw new Error('simulated Telegram outage');
      sent.push(JSON.parse(String(options.body)).chat_id);
      return { ok: true, json: async () => ({ ok: true }) };
    }));
    expect((await POST(request())).status).toBe(503);
    const rows = () => fixture.owner.query('SELECT * FROM "OutboxEvent" WHERE "tenantId"=$1 AND payload->>\'ruleId\'=$2 ORDER BY "createdAt"', [tenant, ruleId]);
    const original = (await rows()).rows[0];
    await inContext(() => moveToDlq(original.id, original.type, original.aggregateId, original.payload, new Error('Telegram timeout'), 5, { tenantId: tenant, aggregateType: 'Notification', consumer: 'published', alertEnabled: async () => false }));
    await inContext(() => db.outboxEvent.update({ where: { id: original.id }, data: { published: true, attempts: 5, lastError: 'Moved to DLQ: Telegram timeout' } }));
    recovered = true;
    expect((await POST(request())).status).toBe(200);
    expect(sent).toEqual(['A', 'B']);
    const attempts = (await rows()).rows;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ id: original.id, published: true, attempts: 5, lastError: 'Moved to DLQ: Telegram timeout' });
    expect(attempts[1]).toMatchObject({ published: true, attempts: 0, payload: { telegramDeliveredChatIds: ['A', 'B'] } });
    expect((await fixture.owner.query('SELECT "sourceOutboxId",status FROM "DeadLetterQueue" WHERE "tenantId"=$1', [tenant])).rows)
      .toEqual([{ sourceOutboxId: original.id, status: 'pending' }]);
  });
  it('M8: real Media rows/files unchanged; dry-run deletes nothing; apply only old temporary UUID PDF', async () => {
    const { cleanupTemporaryPdfs } = await import('@/lib/pdf-generator/cleanup');
    files = join(workspace, '.tmp', 'codex-d2-pdf-' + randomUUID());
    const root = join(files, 'storage', 'pdf-results'); await mkdir(root, { recursive: true });
    const now = new Date(); const old = new Date(now.getTime() - 31 * 86400000);
    const temporary = join(root, randomUUID() + '.pdf');
    const fresh = join(root, randomUUID() + '.pdf');
    const photo = join(files, 'storage', 'media', tenant, 'report', report, randomUUID() + '.jpg');
    const attachment = photo.replace('.jpg', '.pdf'); await mkdir(resolve(photo, '..'), { recursive: true });
    for (const [file, body] of [[temporary, '%PDF-old'], [fresh, '%PDF-fresh'], [photo, 'JPEG-photo'], [attachment, '%PDF-attachment']] as const) {
      await writeFile(file, body); if (file !== fresh) await utimes(file, old, old);
    }
    for (const [index, file] of [photo, attachment].entries()) {
      const key = relative(join(files, 'storage'), file).split(sep).join('/');
      await fixture.owner.query('INSERT INTO "Media" (id,"tenantId","userId","entityType","entityId","fileName","contentType",key,"uploadStatus","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [tenant + '-media-' + index, tenant, fixture.id(tenant, 'User'), 'report', report, file.split(sep).at(-1), index === 0 ? 'image/jpeg' : 'application/pdf', key, 'completed']);
    }
    const rows = () => fixture.owner.query('SELECT * FROM "Media" WHERE "tenantId"=$1 ORDER BY id', [tenant]);
    const before = (await rows()).rows;
    const contents = await Promise.all([photo, attachment].map(p => readFile(p)));
    vi.stubEnv('S3_ENDPOINT', ''); vi.stubEnv('S3_ACCESS_KEY_ID', ''); vi.stubEnv('S3_SECRET_ACCESS_KEY', '');
    vi.spyOn(process, 'cwd').mockReturnValue(files);
    expect(await cleanupTemporaryPdfs({ now })).toEqual({ dryRun: true, candidates: 1, deleted: 0 });
    expect(existsSync(temporary)).toBe(true); expect((await rows()).rows).toEqual(before);
    expect(await cleanupTemporaryPdfs({ now, dryRun: false })).toEqual({ dryRun: false, candidates: 1, deleted: 1 });
    expect(existsSync(temporary)).toBe(false); expect(existsSync(fresh)).toBe(true);
    expect((await rows()).rows).toEqual(before);
    expect(await Promise.all([photo, attachment].map(p => readFile(p)))).toEqual(contents);
  });
});
