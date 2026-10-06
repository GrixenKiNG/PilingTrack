import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createFixture } from './helpers/disposable-db';
import { apiRouteInventory, inventoryDifference } from './helpers/authz-route-inventory';
import { AUTHZ_ACTORS, authzRouteManifest, type AuthzActor } from './authz-route-manifest';
import { DEFAULT_READINESS_RULES } from '../../src/modules/readiness/domain/readiness-rules';

const enabled = Boolean(process.env.CODEX_STAND_URL && process.env.INTEGRATION_DATABASE_URL_OWNER);

describe('every API method has reviewed authorization expectations', () => {
  it('has no missing, obsolete or duplicate manifest rows', () => {
    expect(inventoryDifference(apiRouteInventory(), authzRouteManifest.map(row => row.key))).toEqual({missing: [], obsolete: [], duplicates: []});
  });
  it('detects an added route, removed route and duplicate row', () => {
    expect(inventoryDifference(['GET /api/new'], ['POST /api/old', 'POST /api/old'])).toEqual({
      missing: ['GET /api/new'], obsolete: ['POST /api/old', 'POST /api/old'], duplicates: ['POST /api/old'],
    });
  });
  it('pins exactly nine actor expectations and source/fixture notes on every method', () => {
    for (const row of authzRouteManifest) {
      expect(Object.keys(row.expectations).sort(), row.key).toEqual([...AUTHZ_ACTORS].sort());
      expect(row.source, row.key).toMatch(/^src\/app\/api/);
      expect(row.fixture, row.key).not.toBe('');
      expect(row.tenantPolicy, row.key).not.toBe('');
    }
  });
});

// Role gates use an existing resource in the actor's OWN tenant. Separate
// foreign-resource checks below distinguish isolation from role permissions.
// A skipped allow-cell is a missing business fixture, never an authorization pass.
const pendingReads = new Set<string>();
const writableScenarios = new Set([
  'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/user-document-types',
  'POST /api/users/[id]/documents', 'PUT /api/users/[id]/documents/[docId]',
  'DELETE /api/users/[id]/documents/[docId]', 'POST /api/briefings',
  'POST /api/assistant/command', 'POST /api/operator/mobile/command',
  'POST /api/checklist-templates', 'POST /api/equipment', 'POST /api/sites/create',
  'POST /api/dictionary/manage', 'POST /api/readiness/place-presets',
  'DELETE /api/readiness/place-presets', 'PUT /api/monitoring/template',
  'PUT /api/layout/[surfaceId]', 'DELETE /api/layout/[surfaceId]',
  'POST /api/equipment/[id]/documents', 'PUT /api/equipment/[id]/documents/[docId]',
  'DELETE /api/equipment/[id]/documents/[docId]', 'POST /api/equipment/[id]/fuel',
  'DELETE /api/equipment/[id]/fuel/[entryId]', 'POST /api/equipment/[id]/meter-readings',
  'DELETE /api/equipment/[id]/meter-readings/[readingId]', 'POST /api/equipment/[id]/maintenance',
  'PUT /api/equipment/[id]/maintenance/[recordId]', 'DELETE /api/equipment/[id]/maintenance/[recordId]',
  'POST /api/maintenance-plans', 'PATCH /api/maintenance-plans/[id]', 'DELETE /api/maintenance-plans/[id]',
  'POST /api/briefings/[id]/sign', 'POST /api/readiness/defects',
  'POST /api/readiness/defects/[id]/triage', 'POST /api/readiness/defects/[id]/resolve', 'POST /api/readiness/defects/[id]/reject',
  'PATCH /api/user-document-types/[id]', 'DELETE /api/user-document-types/[id]',
  'PUT /api/equipment/[id]', 'PUT /api/sites/[id]', 'PUT /api/crews/[id]',
  'POST /api/sites/[id]/assign', 'DELETE /api/sites/[id]/assign',
  'POST /api/reports/pdf', 'POST /api/reports/single-pdf', 'POST /api/reports/admin-upsert',
  'POST /api/safety/equipment-permits', 'DELETE /api/safety/equipment-permits/[id]',
  'POST /api/readiness/work-permits/[id]/approve', 'PUT /api/settings',
  'POST /api/feedback/events', 'PATCH /api/feedback/events',
  'POST /api/crews', 'DELETE /api/crews/[id]', 'DELETE /api/equipment/[id]',
  'POST /api/users', 'PUT /api/users', 'DELETE /api/users', 'DELETE /api/sites/[id]',
  'POST /api/sites/[id]/hierarchy', 'DELETE /api/sites/[id]/hierarchy',
  'PUT /api/checklist-templates/[id]', 'DELETE /api/checklist-templates/[id]',
  'PATCH /api/dictionary/manage', 'DELETE /api/dictionary/manage',
  'POST /api/inspections', 'PUT /api/inspections/[id]', 'POST /api/inspections/[id]/complete',
  'POST /api/equipment/[id]/device-keys', 'DELETE /api/equipment/[id]/device-keys',
  'POST /api/admin/dlq', 'POST /api/admin/incidents', 'POST /api/maintenance/[id]/accept',
  'POST /api/maintenance-plans/run', 'POST /api/readiness/work-permits',
  'PATCH /api/readiness/work-permits/[id]', 'POST /api/readiness/work-permits/[id]/submit', 'POST /api/readiness/work-permits/[id]/revoke',
  'POST /api/readiness/shifts', 'PATCH /api/readiness/shifts/[id]',
  'POST /api/readiness/shifts/[id]/request-acceptance', 'POST /api/readiness/shifts/[id]/cancel',
  'POST /api/readiness/shifts/[id]/decline', 'POST /api/readiness/shifts/[id]/start',
  'POST /api/readiness/shifts/[id]/handover', 'POST /api/readiness/shifts/[id]/waiver',
  'POST /api/readiness/handovers/[id]/accept', 'POST /api/readiness/handovers/[id]/rework',
  'PUT /api/readiness-rules', 'POST /api/readiness-rules/publish',
  'PUT /api/readiness/access-matrix', 'POST /api/readiness/access-matrix',
  'DELETE /api/reports/delete', 'POST /api/reports/upsert', 'POST /api/pile-passports/[id]/decide',
  'POST /api/telegram/configs', 'PUT /api/telegram/configs', 'DELETE /api/telegram/configs',
  'POST /api/notifications/telegram/test', 'POST /api/orion/lead',
  'POST /api/admin/projections/rebuild', 'POST /api/media', 'DELETE /api/media/[id]', 'POST /api/media/[id]/confirm',
  'POST /api/telemetry', 'POST /api/telemetry/batch',
]);

const createdResponses = new Set([
  'POST /api/user-document-types', 'POST /api/users/[id]/documents', 'POST /api/briefings',
  'POST /api/checklist-templates', 'POST /api/equipment', 'POST /api/sites/create',
  'POST /api/equipment/[id]/documents', 'POST /api/equipment/[id]/fuel',
  'POST /api/equipment/[id]/meter-readings', 'POST /api/equipment/[id]/maintenance',
  'POST /api/maintenance-plans', 'POST /api/readiness/defects', 'POST /api/safety/equipment-permits',
  'POST /api/feedback/events',
  'POST /api/users', 'POST /api/inspections', 'POST /api/equipment/[id]/device-keys',
  'POST /api/readiness/work-permits', 'POST /api/readiness/shifts',
  'POST /api/readiness/shifts/[id]/handover', 'POST /api/readiness/shifts/[id]/waiver',
  'POST /api/telegram/configs',
]);

describe.skipIf(!enabled)('G3 HTTP authorization matrix: nine actors × every API method', () => {
  let db: Awaited<ReturnType<typeof createFixture>>;
  let base: string;
  let weatherRedis: Redis;
  let weatherKey: string;
  let weatherOwned = false;
  const ownLeadNames: string[] = [];
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1EAAAAASUVORK5CYII=', 'base64');
  let s3: S3Client;
  const ownS3Keys = new Set<string>();
  const telemetryMarkers: {equipmentId: string; value: number; accepted: boolean}[] = [];
  const latitude = Number((randomBytes(2).readUInt16BE(0) / 1000).toFixed(2));
  const longitude = Number((randomBytes(2).readUInt16BE(0) / 1000).toFixed(2));
  const ownIp = () => '198.18.' + randomBytes(1).readUInt8(0) + '.' + randomBytes(1).readUInt8(0);
  const identities = new Map<string, {id: string; tenant: string; email: string; password: string; cookie: string; ip: string}>();
  const insert = async (table: string, values: Record<string, unknown>) => {
    const fields = Object.keys(values);
    if (![table, ...fields].every(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value))) throw new Error('Invalid fixture identifier');
    await db.owner.query('INSERT INTO "' + table + '" (' + fields.map(field => '"' + field + '"').join(',') + ') VALUES (' + fields.map((_, index) => '$' + (index + 1)).join(',') + ')', Object.values(values));
    return values.id as string;
  };
  const actorIdentity = (actor: AuthzActor) => {
    const identity = identities.get(actor.startsWith('ADMIN_AS_') ? 'ADMIN' : actor === 'UNAUTHENTICATED' ? 'OPERATOR' : actor);
    if (!identity) throw new Error('Fixture identity missing for ' + actor);
    return identity;
  };
  const headersFor = (actor: AuthzActor): Record<string, string> => ({
    Origin: base, 'Content-Type': 'application/json',
    'X-Forwarded-For': actorIdentity(actor).ip,
    ...(actor === 'UNAUTHENTICATED' ? {} : {Cookie: actorIdentity(actor).cookie}),
    ...(actor.startsWith('ADMIN_AS_') ? {'x-acting-as': actor.slice('ADMIN_AS_'.length)} : {}),
  });
  const logIn = async (identity: {email: string; password: string; ip: string}) => {
    const result = await fetch(base + '/api/auth/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json', 'X-Forwarded-For': identity.ip}, body: JSON.stringify({email: identity.email, password: identity.password})});
    expect(result.status, 'fixture login').toBe(200);
    const session = result.headers.getSetCookie().find(value => value.startsWith('pt-session='))?.split(';')[0] || '';
    expect(Boolean(session), 'fixture session').toBe(true);
    return session;
  };
  beforeAll(async () => {
    const url = new URL(process.env.CODEX_STAND_URL || 'http://invalid');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw new Error('Owned local stand required');
    base = url.origin;
    db = await createFixture();
    const endpoint = new URL(process.env.S3_ENDPOINT || 'http://invalid');
    if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'https:' || process.env.S3_BUCKET !== 'codex-photos' || !process.env.S3_ACCESS_KEY_ID?.startsWith('codex')) throw new Error('Owned HTTPS S3 required');
    s3 = new S3Client({endpoint: endpoint.origin, region: process.env.S3_REGION, forcePathStyle: true, credentials: {accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || ''}});
    const redisUrl = new URL(process.env.REDIS_URL_CACHE || 'redis://invalid');
    if (!['127.0.0.1', 'localhost'].includes(redisUrl.hostname) || !redisUrl.port || redisUrl.port === '6379') throw new Error('Owned mapped cache Redis required for weather fixture');
    weatherRedis = new Redis(redisUrl.toString(), {maxRetriesPerRequest: 1, connectTimeout: 5000});
    weatherKey = `pilingtrack:weather:conditions:point:${latitude.toFixed(2)}:${longitude.toFixed(2)}`;
    weatherOwned = await weatherRedis.set(weatherKey, JSON.stringify({d: {windMs: 7, temperatureC: 10, precipitationMmPerHour: 0, isDay: true, at: new Date().toISOString()}, t: Date.now()}), 'EX', 900, 'NX') === 'OK';
    if (!weatherOwned) throw new Error('Weather fixture key already exists; no existing key is changed');
    const password = randomBytes(24).toString('hex');
    const hash = await bcrypt.hash(password, 10);
    for (const category of ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'OTHER_TENANT_OPERATOR', 'OTHER_TENANT_ASSISTANT']) {
      const tenant = db.tenants[category.startsWith('OTHER_TENANT_') ? 1 : 0];
      const role = category.replace('OTHER_TENANT_', '');
      const id = role === 'OPERATOR' ? db.id(tenant, 'User') : db.id(tenant, 'matrix-' + role);
      const email = id + '@example.invalid';
      await db.owner.query('INSERT INTO "User" (id,"tenantId",email,password,name,role,"updatedAt") VALUES ($1,$2,$3,$4,$1,$5,now()) ON CONFLICT (id) DO UPDATE SET password=$4,role=$5', [id, tenant, email, hash, role]);
      const identity = {id, tenant, email: role === 'OPERATOR' ? tenant + '@example.invalid' : email, password, cookie: '', ip: ownIp()};
      identity.cookie = await logIn(identity);
      identities.set(category, identity);
    }
    for (const tenant of db.tenants) {
      await insert('TenantSettings', {id: db.id(tenant, 'settings'), tenantId: tenant, companyName: 'G3 matrix', updatedAt: new Date()});
      await insert('PermitWorkType', {id: db.id(tenant, 'work-type'), tenantId: tenant, name: 'G3 matrix', normalizedName: 'g3 matrix', requiredApprovals: ['ADMIN', 'DISPATCHER'], updatedAt: new Date()});
      await insert('ReadinessRuleSet', {id: randomUUID(), tenantId: tenant, status: 'PUBLISHED', version: DEFAULT_READINESS_RULES.version, criteria: JSON.stringify(DEFAULT_READINESS_RULES.criteria), blockers: JSON.stringify(DEFAULT_READINESS_RULES.blockers), publishedAt: new Date(), updatedAt: new Date()});
      for (const identity of identities.values()) if (identity.tenant === tenant && identity.id !== db.id(tenant, 'User')) await insert('UserSiteAssignment', {id: randomUUID(), userId: identity.id, siteId: db.id(tenant, 'Site'), updatedAt: new Date()});
      await db.owner.query('INSERT INTO "Crew" (id,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$2,$3,$4,now())', [db.id(tenant, 'Crew'), db.id(tenant, 'User'), db.id(tenant, 'Equipment'), db.id(tenant, 'Site')]);
      const assistant = [...identities.values()].find(identity => identity.tenant === tenant && identity.id.endsWith('matrix-assistant'));
      if (!assistant) throw new Error('Assistant fixture missing');
      await db.owner.query('INSERT INTO "CrewAssistant" (id,"crewId","userId",name,"updatedAt") VALUES ($1,$2,$3,$1,now())', [db.id(tenant, 'CrewAssistant'), db.id(tenant, 'Crew'), assistant.id]);
      await db.owner.query('INSERT INTO "UserSiteAssignment" (id,"userId","siteId","updatedAt") VALUES ($1,$2,$3,now())', [db.id(tenant, 'assignment'), db.id(tenant, 'User'), db.id(tenant, 'Site')]);
      await db.owner.query('INSERT INTO "UserDocumentType" (id,"tenantId",name,"normalizedName","requiresExpiry","updatedAt") VALUES ($1,$2,$1,$1,false,now())', [db.id(tenant, 'type'), tenant]);
      const mediaKey = 'media/' + tenant + '/equipment/' + db.id(tenant, 'Equipment') + '/' + randomUUID() + '.png';
      ownS3Keys.add(mediaKey); await s3.send(new PutObjectCommand({Bucket: 'codex-photos', Key: mediaKey, ContentType: 'image/png', Body: tinyPng}));
      await insert('Media', {id: db.id(tenant, 'Media'), tenantId: tenant, userId: db.id(tenant, 'User'), entityType: 'equipment', entityId: db.id(tenant, 'Equipment'), fileName: 'matrix.png', fileSize: tinyPng.length, contentType: 'image/png', key: mediaKey, uploadStatus: 'completed', updatedAt: new Date()});
      await insert('MaintenanceRecord', {id: db.id(tenant, 'MaintenanceRecord'), tenantId: tenant, equipmentId: db.id(tenant, 'Equipment'), type: 'TO1', title: 'G3 matrix', updatedAt: new Date()});
      await insert('ShiftHandover', {id: db.id(tenant, 'ShiftHandover'), tenantId: tenant, shiftId: db.id(tenant, 'Shift'), summary: 'G3 matrix', submittedById: db.id(tenant, 'User'), updatedAt: new Date()});
      await insert('WorkPermit', {id: db.id(tenant, 'WorkPermit'), tenantId: tenant, equipmentId: db.id(tenant, 'Equipment'), risk: 'NORMAL', scope: 'G3 matrix', validFrom: new Date(), validTo: new Date(Date.now() + 86400_000), timezone: 'Europe/Moscow', authorId: db.id(tenant, 'User'), lastEditedById: db.id(tenant, 'User'), updatedAt: new Date()});
    }
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    try {
      const accepted = telemetryMarkers.filter(marker => marker.accepted);
      if (accepted.length) {
        const deadline = Date.now() + 12_000;
        let count = 0;
        do { count = (await db.owner.query('SELECT count(*)::int AS n FROM "TelemetryRecord" WHERE "equipmentId"=ANY($1::text[]) AND value=ANY($2::float8[])', [accepted.map(marker => marker.equipmentId), accepted.map(marker => marker.value)])).rows[0].n; if (count === accepted.length) break; await new Promise(resolve => setTimeout(resolve, 250)); } while (Date.now() < deadline);
        expect(count, 'all accepted telemetry markers persisted').toBe(accepted.length);
        await new Promise(resolve => setTimeout(resolve, 5500));
        const denied = telemetryMarkers.filter(marker => !marker.accepted);
        expect((await db.owner.query('SELECT count(*)::int AS n FROM "TelemetryRecord" WHERE "equipmentId"=ANY($1::text[]) AND value=ANY($2::float8[])', [denied.map(marker => marker.equipmentId), denied.map(marker => marker.value)])).rows[0].n, 'denied telemetry never persists after flush').toBe(0);
      }
      // Only rows belonging to the two random tenants created by this suite.
      // Discover FK order instead of maintaining a fragile schema-wide delete list.
      // Immutable evidence is retained until the owned container is removed.
      // Never disable append-only triggers, even in fixture cleanup.
      const immutable = new Set(['AuditLog', 'TenantAuditChain', 'AuditChainHead', 'AuditChainRoot', 'ReadinessTransition', 'ReadinessScoreSnapshot', 'OperatorChecklistAnswerRecord']);
      if (ownLeadNames.length) await db.owner.query('DELETE FROM "OrionLead" WHERE name=ANY($1::text[])', [ownLeadNames]);
      const tables = (await db.owner.query('SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name=$2', ['public', 'tenantId'])).rows.map(row => row.table_name as string).filter(table => !immutable.has(table));
      let pending = tables;
      for (let attempt = 0; pending.length && attempt < 2; attempt++) {
        const remaining: string[] = [];
        for (const table of pending) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Unexpected table identifier');
          try { await db.owner.query('DELETE FROM "' + table + '" WHERE "tenantId"=ANY($1::text[])', [db.tenants]); }
          catch (error) { if ((error as {code?: string}).code !== '23503') throw error; remaining.push(table); }
        }
        if (remaining.length === pending.length) break; // Retain only fixtures linked to immutable history.
        pending = remaining;
      }
      for (const tenant of db.tenants) {
        try { await db.owner.query('DELETE FROM "Tenant" WHERE id=$1', [tenant]); }
        catch (error) { if ((error as {code?: string}).code !== '23503') throw error; }
      }
    } finally {
      if (s3) { try { for (const Key of ownS3Keys) await s3.send(new DeleteObjectCommand({Bucket: 'codex-photos', Key})); } finally { s3.destroy(); } }
      if (weatherRedis) { if (weatherOwned) await weatherRedis.del(weatherKey); await weatherRedis.quit(); }
      await Promise.all([db.app.end(), db.owner.end()]);
    }
  }, 60_000);

  const scenario = async (key: string, actor: AuthzActor) => {
    const identity = actorIdentity(actor);
    const tenant = identity.tenant;
    const equipment = db.id(tenant, 'Equipment');
    const operator = db.id(tenant, 'User');
    const type = db.id(tenant, 'type');
    const [method, template] = key.split(' ');
    let path = template;
    let body: unknown = {};
    const query = new URLSearchParams();
    if (template.startsWith('/api/equipment/')) path = path.replace('[id]', equipment);
    else if (template.startsWith('/api/sites/')) path = path.replace('[id]', db.id(tenant, 'Site'));
    else if (template.startsWith('/api/users/')) path = path.replace('[id]', operator);
    else if (template.startsWith('/api/checklist-templates/')) path = path.replace('[id]', db.id(tenant, 'ChecklistTemplate'));
    else if (template.startsWith('/api/crews/')) path = path.replace('[id]', db.id(tenant, 'Crew'));
    else if (template.startsWith('/api/inspections/')) path = path.replace('[id]', db.id(tenant, 'Inspection'));
    else if (template.startsWith('/api/reports/')) path = path.replace('[id]', db.id(tenant, 'Report'));
    else if (template.startsWith('/api/readiness/shifts/')) path = path.replace('[id]', db.id(tenant, 'Shift'));
    else if (template.startsWith('/api/readiness/handovers/')) path = path.replace('[id]', db.id(tenant, 'ShiftHandover'));
    else if (template.startsWith('/api/readiness/work-permits/')) path = path.replace('[id]', db.id(tenant, 'WorkPermit'));
    else if (template.startsWith('/api/maintenance/')) path = path.replace('[id]', db.id(tenant, 'MaintenanceRecord'));
    else if (template.startsWith('/api/briefings/')) path = path.replace('[id]', db.id(tenant, 'BriefingRecord'));
    else if (template.startsWith('/api/media/')) path = path.replace('[id]', db.id(tenant, 'Media'));
    path = path.replace('[surfaceId]', 'monitoring-equipment-tile').replace('[id]', db.id(tenant, 'pending')).replace('[docId]', db.id(tenant, 'document')).replace(/\[[^\]]+\]/g, db.id(tenant, 'pending'));
    if (method === 'GET') {
      if (template.includes('analytics') || template === '/api/reports/period' || template === '/api/reports/pdf' || template === '/api/reports/export') {
        query.set('dateFrom', '2026-10-02'); query.set('dateTo', '2026-10-02');
        query.set('siteId', db.id(tenant, 'Site'));
      }
      if (template === '/api/admin/analytics/site-weekly-trend') query.set('siteId', db.id(tenant, 'Site'));
      if (template === '/api/reports/edit') { query.set('userId', identity.id); query.set('siteId', db.id(tenant, 'Site')); query.set('date', '2026-10-02'); }
      if (template === '/api/reports/single-pdf') { query.set('reportId', db.id(tenant, 'Report')); query.set('sync', '1'); }
      if (template === '/api/reports/pdf') query.set('sync', '1');
      if (template === '/api/readiness/export') query.set('dataset', 'fleet');
      if (template === '/api/readiness/current') query.set('equipmentId', equipment);
      if (template === '/api/to/journal') query.set('equipmentId', equipment);
      if (template === '/api/audit') { query.set('scope', 'reports'); query.set('targetId', db.id(tenant, 'Report')); }
      if (template === '/api/readiness/bootstrap' && actor.startsWith('ADMIN_AS_')) query.set('actingAs', actor.slice('ADMIN_AS_'.length));
      if (template === '/api/media') { query.set('entityType', 'equipment'); query.set('entityId', equipment); }
      if (template === '/api/media/download-batch') query.set('ids', db.id(tenant, 'Media'));
      if (template === '/api/telemetry') { query.set('from', '2026-01-01T00:00:00.000Z'); query.set('to', '2027-01-01T00:00:00.000Z'); query.set('equipmentId', equipment); }
      if (template === '/api/weather') { query.set('lat', String(latitude)); query.set('lon', String(longitude)); }
    } else {
      const name = 'G3 matrix ' + randomUUID();
      if (key === 'POST /api/auth/login') body = {email: identity.email, password: identity.password};
      if (template === '/api/briefings') body = {userId: operator, type: 'PRIMARY', documentCode: 'codex', documentTitle: name, documentVersion: '1'};
      if (template === '/api/user-document-types') body = {name, requiresExpiry: false};
      if (template === '/api/users/[id]/documents') body = {typeId: type, notes: name};
      if (template.endsWith('/documents/[docId]')) {
        const id = db.id(tenant, 'document');
        await db.owner.query('INSERT INTO "UserDocument" (id,"tenantId","userId","typeId",notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (id) DO UPDATE SET notes=$5', [id, tenant, operator, type, 'unchanged']);
        body = {notes: name};
      }
      if (template === '/api/assistant/command' || template === '/api/operator/mobile/command') body = {command: 'acknowledge-briefing'};
      if (template === '/api/checklist-templates') body = {name, level: 'EO', sections: []};
      if (template === '/api/equipment' || template === '/api/sites/create') body = {name};
      if (template === '/api/dictionary/manage') body = {type: 'downtimeReason', name};
      if (template === '/api/readiness/place-presets') {
        body = {location: name};
        if (method === 'DELETE') {
          const id = randomUUID();
          await db.owner.query('INSERT INTO "UserPlacePreset" (id,"tenantId","userId",location,"objectName","normalizedKey","updatedAt") VALUES ($1,$2,$3,$4,$5,$4,now())', [id, tenant, identity.id, name, '']);
          query.set('id', id);
        }
      }
      if (key === 'PUT /api/monitoring/template' || key === 'PUT /api/layout/[surfaceId]') {
        const original = await fetch(base + path, {headers: headersFor(actor === 'UNAUTHENTICATED' ? 'ADMIN' : actor)});
        expect(original.status, 'valid saved template control').toBe(200);
        body = await original.json();
      }
      if (template === '/api/media') body = {fileName: 'matrix.pdf', contentType: 'application/pdf', fileSize: 1, entityType: 'equipment', entityId: equipment};
      if (template === '/api/feedback/events') body = method === 'PATCH' ? {operation: 'read_all'} : {title: name, message: name, audience: 'USER'};
      if (template === '/api/briefings/[id]/sign') {
        const instructor = actorIdentity('ADMIN').id;
        await db.owner.query('UPDATE "BriefingRecord" SET "instructorId"=$1,"employeeSignedAt"=NULL,"instructorSignedAt"=NULL WHERE id=$2', [instructor, db.id(tenant, 'BriefingRecord')]);
      }
      if (template === '/api/equipment/[id]/documents') body = {type: 'PASSPORT', title: name};
      if (template === '/api/equipment/[id]/documents/[docId]') {
        const id = await insert('EquipmentDocument', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, type: 'PASSPORT', title: name, updatedAt: new Date()});
        path = template.replace('[id]', equipment).replace('[docId]', id); body = {title: name + ' edited'};
      }
      if (template === '/api/equipment/[id]/fuel') body = {litersAdded: 1, note: name};
      if (template === '/api/equipment/[id]/meter-readings') body = {engineHours: 0, note: name};
      if (template === '/api/equipment/[id]/fuel/[entryId]' || template === '/api/equipment/[id]/meter-readings/[readingId]') {
        const fuel = template.includes('/fuel/');
        const id = await insert(fuel ? 'FuelLog' : 'MeterReading', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, recordedAt: new Date(), ...(fuel ? {litersAdded: 1} : {engineHours: 0})});
        path = template.replace('[id]', equipment).replace(fuel ? '[entryId]' : '[readingId]', id);
      }
      if (template === '/api/equipment/[id]/maintenance') body = {type: 'TO1', title: name};
      if (template === '/api/equipment/[id]/maintenance/[recordId]') {
        const id = await insert('MaintenanceRecord', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, type: 'TO1', title: name, updatedAt: new Date()});
        path = template.replace('[id]', equipment).replace('[recordId]', id); body = {title: name + ' edited'};
      }
      if (template === '/api/maintenance-plans') body = {equipmentId: equipment, title: name, triggerType: 'HOURS', intervalHours: 100};
      if (template === '/api/maintenance-plans/[id]') {
        const id = await insert('MaintenancePlan', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, title: name, triggerType: 'HOURS', intervalHours: 100, updatedAt: new Date()});
        path = template.replace('[id]', id); body = {title: name + ' edited'};
      }
      if (template === '/api/user-document-types/[id]') {
        const id = await insert('UserDocumentType', {id: randomUUID(), tenantId: tenant, name, normalizedName: name.toLowerCase(), requiresExpiry: false, updatedAt: new Date()});
        path = template.replace('[id]', id); body = {notes: name};
      }
      if (['PUT /api/equipment/[id]', 'PUT /api/sites/[id]', 'PUT /api/crews/[id]'].includes(key)) body = {name};
      if (key === 'PUT /api/equipment/[id]') body = {name, expectedUpdatedAt: (await db.owner.query('SELECT "updatedAt" FROM "Equipment" WHERE id=$1', [equipment])).rows[0].updatedAt.toISOString()};
      if (template === '/api/sites/[id]/assign') {
        body = {userId: operator};
        if (method === 'DELETE') {
          const temporaryUser = await insert('User', {id: randomUUID(), tenantId: tenant, email: randomUUID() + '@example.invalid', name, updatedAt: new Date()});
          await insert('UserSiteAssignment', {id: randomUUID(), userId: temporaryUser, siteId: db.id(tenant, 'Site'), updatedAt: new Date()});
          query.set('userId', temporaryUser);
        }
      }
      if (template === '/api/safety/equipment-permits') body = {userId: operator, equipmentKind: 'PILE_DRIVER', equipmentModel: name, scope: 'OPERATION', status: 'ALLOWED'};
      if (template === '/api/safety/equipment-permits/[id]') {
        const id = await insert('UserEquipmentPermit', {id: randomUUID(), tenantId: tenant, userId: operator, equipmentKind: 'PILE_DRIVER', equipmentModel: name, scope: 'OPERATION', updatedAt: new Date()});
        path = template.replace('[id]', id);
      }
      if (template === '/api/reports/admin-upsert') {
        const site = await insert('Site', {id: randomUUID(), tenantId: tenant, name, updatedAt: new Date()});
        await insert('UserSiteAssignment', {id: randomUUID(), userId: operator, siteId: site, updatedAt: new Date()});
        const reason = await insert('DowntimeReason', {id: randomUUID(), tenantId: tenant, name, normalizedName: name.toLowerCase(), updatedAt: new Date()});
        body = {reportId: randomUUID(), siteId: site, userId: operator, date: '2026-10-02', piles: [], drillings: [], downtimes: [{reasonId: reason, duration: 1}]};
      }
      if (template === '/api/reports/pdf') body = {dateFrom: '2026-10-02', dateTo: '2026-10-02', siteId: db.id(tenant, 'Site')};
      if (template === '/api/reports/upsert' || template === '/api/reports/delete') {
        const site = await insert('Site', {id: randomUUID(), tenantId: tenant, name, updatedAt: new Date()});
        await insert('UserSiteAssignment', {id: randomUUID(), userId: identity.id, siteId: site, updatedAt: new Date()});
        const report = randomUUID();
        const reason = await insert('DowntimeReason', {id: randomUUID(), tenantId: tenant, name, normalizedName: name.toLowerCase(), updatedAt: new Date()});
        body = {reportId: report, siteId: site, userId: identity.id, date: new Date().toISOString().slice(0, 10), piles: [], drillings: [], downtimes: [{reasonId: reason, duration: 1}]};
        if (template.endsWith('/delete')) { await insert('Report', {id: randomUUID(), reportId: report, tenantId: tenant, siteId: site, userId: operator, date: '2026-10-02', updatedAt: new Date()}); body = {reportId: report}; }
      }
      if (template === '/api/pile-passports/[id]/decide') {
        const grade = await insert('PileGrade', {id: randomUUID(), tenantId: tenant, name, normalizedName: name.toLowerCase(), updatedAt: new Date()});
        const work = await insert('PileWork', {id: randomUUID(), tenantId: tenant, reportId: db.id(tenant, 'Report'), pileGradeId: grade, count: 1});
        path = template.replace('[id]', await insert('PilePassport', {id: randomUUID(), tenantId: tenant, pileWorkId: work, pileNumber: name, clientCommandId: randomUUID(), drivenAt: new Date(), updatedAt: new Date()})); body = {acceptance: 'ACCEPTED'};
      }
      if (template === '/api/telegram/configs' || template === '/api/notifications/telegram/test') {
        const transport = new URL(process.env.TELEGRAM_API_BASE || 'http://invalid');
        if (!['127.0.0.1', 'localhost'].includes(transport.hostname) || !transport.port) throw new Error('Owned loopback Telegram transport fixture required');
        const config = {label: name, botToken: 'codex-fixture-' + randomBytes(24).toString('hex'), chatId: name, enabled: false};
        body = config;
        if (method !== 'POST' || template.endsWith('/test')) {
          const id = await insert('TelegramConfig', {id: randomUUID(), tenantId: tenant, ...config, updatedAt: new Date()});
          body = template.endsWith('/test') ? {configId: id} : method === 'PUT' ? {id, label: name + ' edited'} : {id};
        }
      }
      if (template === '/api/orion/lead') {
        const transport = new URL(process.env.TELEGRAM_API_BASE || 'http://invalid');
        if (!['127.0.0.1', 'localhost'].includes(transport.hostname) || !transport.port) throw new Error('Owned loopback Telegram transport fixture required');
        ownLeadNames.push(name); body = {name, contact: name + '@example.invalid', message: name, consent: true, website: ''};
      }
      if (template === '/api/reports/single-pdf') body = {reportId: db.id(tenant, 'Report')};
      if (template === '/api/readiness/defects') body = {equipmentId: equipment, severity: 'NORMAL', title: name};
      if (template.startsWith('/api/readiness/defects/')) {
        const id = await insert('EquipmentDefect', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, title: name, reportedById: operator, status: template.endsWith('/resolve') ? 'IN_WORK' : 'OPEN', updatedAt: new Date()});
        path = template.replace('[id]', id); body = template.endsWith('/resolve') ? {expectedVersion: 1, resolution: name} : template.endsWith('/reject') ? {expectedVersion: 1, reason: name} : {expectedVersion: 1, comment: name};
      }
      if (template === '/api/readiness/shifts') body = {equipmentId: equipment, type: 'DAY'};
      if (template.startsWith('/api/readiness/shifts/')) body = template.endsWith('/handover') ? {expectedVersion: 1, summary: name} : template.endsWith('/cancel') || template.endsWith('/decline') || template.endsWith('/waiver') ? {expectedVersion: 1, reason: name} : method === 'PATCH' ? {expectedVersion: 1, type: 'NIGHT'} : {expectedVersion: 1};
      if (template.startsWith('/api/readiness/handovers/')) body = template.endsWith('/rework') ? {expectedVersion: 1, reason: name} : {expectedVersion: 1};
      if (template === '/api/readiness/work-permits') body = {equipmentId: equipment, workTypeId: db.id(tenant, 'work-type'), risk: 'NORMAL', title: name, scope: name, location: name, producerName: name, validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 86400_000).toISOString()};
      if (template.startsWith('/api/readiness/work-permits/')) body = template.endsWith('/revoke') ? {expectedVersion: 1, reason: name} : method === 'PATCH' ? {expectedVersion: 1, title: name + ' edited'} : {expectedVersion: 1};
      if (template.endsWith('/approve') && template.startsWith('/api/readiness/work-permits/')) {
        const id = await insert('WorkPermit', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, risk: 'NORMAL', state: 'PENDING_APPROVAL', requiredApprovals: ['ADMIN', 'DISPATCHER'], scope: name, validFrom: new Date(), validTo: new Date(Date.now() + 86400_000), timezone: 'Europe/Moscow', authorId: operator, lastEditedById: operator, updatedAt: new Date()});
        path = template.replace('[id]', id);
      }
      if (key === 'PUT /api/settings') { const original = await fetch(base + path, {headers: headersFor('ADMIN')}); expect(original.status).toBe(200); body = await original.json(); }
      if (template === '/api/users') {
        if (method === 'POST') body = {name, email: randomUUID() + '@example.invalid', role: 'OPERATOR', password: randomBytes(24).toString('hex')};
        else { const id = await insert('User', {id: randomUUID(), tenantId: tenant, name, email: randomUUID() + '@example.invalid', updatedAt: new Date()}); body = {id, ...(method === 'PUT' ? {name: name + ' edited'} : {})}; }
      }
      if (key === 'DELETE /api/equipment/[id]') path = template.replace('[id]', await insert('Equipment', {id: randomUUID(), tenantId: tenant, name, updatedAt: new Date()}));
      if (key === 'DELETE /api/sites/[id]') path = template.replace('[id]', await insert('Site', {id: randomUUID(), tenantId: tenant, name, updatedAt: new Date()}));
      if (key === 'POST /api/crews' || key === 'DELETE /api/crews/[id]') {
        const ownEquipment = await insert('Equipment', {id: randomUUID(), tenantId: tenant, name, updatedAt: new Date()});
        const ownOperator = await insert('User', {id: randomUUID(), tenantId: tenant, role: 'OPERATOR', name, email: randomUUID() + '@example.invalid', updatedAt: new Date()});
        body = {name, operatorId: ownOperator, equipmentId: ownEquipment, siteId: db.id(tenant, 'Site'), assistantNames: [], assistantsCount: 0};
        if (method === 'DELETE') path = template.replace('[id]', await insert('Crew', {id: randomUUID(), operatorId: ownOperator, equipmentId: ownEquipment, siteId: db.id(tenant, 'Site'), updatedAt: new Date()}));
      }
      if (template === '/api/sites/[id]/hierarchy') {
        body = {type: 'field', name};
        if (method === 'DELETE') body = {type: 'field', itemId: await insert('PileField', {id: randomUUID(), siteId: db.id(tenant, 'Site'), name, updatedAt: new Date()})};
      }
      if (template === '/api/checklist-templates/[id]') {
        path = template.replace('[id]', await insert('ChecklistTemplate', {id: randomUUID(), tenantId: tenant, name, level: 'EO', updatedAt: new Date()})); body = {name: name + ' edited', level: 'EO', sections: []};
      }
      if (template === '/api/dictionary/manage' && method !== 'POST') body = {type: 'downtimeReason', id: await insert('DowntimeReason', {id: randomUUID(), tenantId: tenant, name, normalizedName: name.toLowerCase(), updatedAt: new Date()}), name: name + ' edited'};
      if (template === '/api/inspections') body = {equipmentId: equipment, templateId: db.id(tenant, 'ChecklistTemplate'), inspectionDate: new Date().toISOString()};
      if (template === '/api/inspections/[id]' || template === '/api/inspections/[id]/complete') {
        const item = randomUUID();
        const id = await insert('Inspection', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, templateId: db.id(tenant, 'ChecklistTemplate'), level: 'EO', performedById: identity.id, inspectionDate: new Date(), templateSnapshot: JSON.stringify([{id: item, sectionTitle: 'G3', text: name, answerType: 'YES_NO', required: true, photoRequired: false}]), updatedAt: new Date()});
        path = template.replace('[id]', id); body = {answers: [{itemId: item, result: 'YES'}]};
        if (template.endsWith('/complete')) { await insert('InspectionAnswer', {id: randomUUID(), tenantId: tenant, inspectionId: id, itemId: item, result: 'YES'}); body = {signedByName: name}; }
      }
      if (template === '/api/equipment/[id]/device-keys') { body = {name}; if (method === 'DELETE') body = {keyId: await insert('DeviceKey', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, keyHash: randomBytes(32).toString('hex'), name})}; }
      if (template === '/api/admin/dlq') body = {action: 'discard', id: await insert('DeadLetterQueue', {id: randomUUID(), tenantId: tenant, eventType: 'codex.fixture', payload: '{}', errorMessage: name, updatedAt: new Date()})};
      if (template === '/api/admin/incidents') body = {note: name, id: await insert('SafetyIncident', {id: randomUUID(), tenantId: tenant, category: 'G3', state: 'OPEN', severity: 'NORMAL', description: name, observedSigns: '[]', stopRequired: false, classificationRuleId: 'codex-fixture', classificationRuleVersion: '1', occurredAt: new Date(), reportedById: operator, clientCommandId: randomUUID(), updatedAt: new Date()})};
      if (template === '/api/maintenance/[id]/accept') path = template.replace('[id]', await insert('MaintenanceRecord', {id: randomUUID(), tenantId: tenant, equipmentId: equipment, type: 'TO1', title: name, status: 'DONE', completedAt: new Date(), workDone: name, updatedAt: new Date()}));
      if (template === '/api/readiness/work-permits' || template.startsWith('/api/readiness/work-permits/')) {
        const valid = {equipmentId: equipment, workTypeId: db.id(tenant, 'work-type'), risk: 'NORMAL', title: name, scope: name, location: name, producerName: name, validFrom: new Date(Date.now() - 60_000), validTo: new Date(Date.now() + 3600_000)};
        if (template === '/api/readiness/work-permits') body = {...valid, validFrom: valid.validFrom.toISOString(), validTo: valid.validTo.toISOString()};
        else {
          const state = template.endsWith('/approve') ? 'PENDING_APPROVAL' : template.endsWith('/revoke') ? 'APPROVED' : 'DRAFT';
          path = template.replace('[id]', await insert('WorkPermit', {id: randomUUID(), tenantId: tenant, ...valid, state, requiredApprovals: ['ADMIN', 'DISPATCHER'], allowAuthorApproval: true, timezone: 'Europe/Moscow', authorId: operator, lastEditedById: operator, updatedAt: new Date()}));
        }
      }
      if (template === '/api/readiness/shifts' || template.startsWith('/api/readiness/shifts/') || template.startsWith('/api/readiness/handovers/')) {
        const ownEquipment = await insert('Equipment', {id: randomUUID(), tenantId: tenant, name, engineHoursTotal: 100, nextMaintenanceAtHours: 200, updatedAt: new Date()});
        await insert('Crew', {id: randomUUID(), equipmentId: ownEquipment, operatorId: operator, siteId: db.id(tenant, 'Site'), updatedAt: new Date()});
        if (template === '/api/readiness/shifts') body = {equipmentId: ownEquipment, type: 'DAY'};
        else {
          const state = template.includes('/handovers/') ? 'HANDOVER_PENDING' : template.endsWith('/handover') ? 'STARTED' : template.endsWith('/start') || template.endsWith('/decline') || template.endsWith('/waiver') ? 'PENDING_ACCEPTANCE' : 'PLANNED';
          const shift = await insert('Shift', {id: randomUUID(), tenantId: tenant, equipmentId: ownEquipment, type: 'DAY', state, productionDate: new Date(), timezone: 'Europe/Moscow', createdById: operator, lastEditedById: operator, updatedAt: new Date()});
          path = template.replace('[id]', shift);
          if (template.includes('/handovers/')) path = template.replace('[id]', await insert('ShiftHandover', {id: randomUUID(), tenantId: tenant, shiftId: shift, state: 'SUBMITTED', summary: name, submittedById: operator, submittedAt: new Date(), updatedAt: new Date()}));
          if (template.endsWith('/handover')) {
            const site = await insert('Site', {id: randomUUID(), tenantId: tenant, name, updatedAt: new Date()});
            await insert('Report', {id: randomUUID(), reportId: randomUUID(), tenantId: tenant, userId: operator, equipmentId: ownEquipment, siteId: site, date: new Date().toISOString().slice(0, 10), shiftId: shift, status: 'submitted', submittedAt: new Date(), updatedAt: new Date()});
          }
          if (template.endsWith('/start')) await insert('Inspection', {id: randomUUID(), tenantId: tenant, equipmentId: ownEquipment, templateId: db.id(tenant, 'ChecklistTemplate'), level: 'EO', performedById: operator, inspectionDate: new Date(), healthScore: 100, templateSnapshot: '[]', status: 'COMPLETED', updatedAt: new Date()});
          if (template.endsWith('/waiver') && !actor.startsWith('OTHER_TENANT_') && actor !== 'UNAUTHENTICATED') {
            const blocked = await fetch(base + '/api/readiness/shifts/' + shift + '/start', {method: 'POST', headers: {...headersFor('ADMIN'), 'Idempotency-Key': randomUUID()}, body: JSON.stringify({expectedVersion: 1})});
            expect(blocked.status, 'real blocked start fixture').toBe(422);
            const result = await blocked.json(); expect(result.error.code).toBe('SHIFT_START_BLOCKED'); body = {reason: name};
          }
        }
      }
      if (key === 'PUT /api/readiness-rules' || key === 'PUT /api/readiness/access-matrix') {
        const original = await fetch(base + path, {headers: headersFor('ADMIN')}); expect(original.status).toBe(200);
        const state = await original.json(); body = (state.data ?? state).published;
      }
    }
    return {method, path: path + (query.size ? '?' + query : ''), body};
  };

  for (const row of authzRouteManifest) for (const actor of AUTHZ_ACTORS) {
    const expected = row.expectations[actor];
    const isRead = row.key.startsWith('GET ');
    const pending = expected === 'allow' && (isRead ? pendingReads.has(row.key) : !writableScenarios.has(row.key));
    it.skipIf(pending)(row.key + ' × ' + actor + (pending ? ' [PENDING: valid lifecycle/external fixture]' : ''), async () => {
      const {method, path, body} = await scenario(row.key, actor);
      const headers = headersFor(actor);
      if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
      if (row.key === 'POST /api/auth/logout' && actor !== 'UNAUTHENTICATED') headers.Cookie = await logIn(actorIdentity(actor));
      if (row.key === 'POST /api/orion/lead') headers['X-Forwarded-For'] = ownIp();
      const response = await fetch(base + path, {method, headers, body: method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000)});
      const wanted = expected === 'unauthenticated' || expected === 'service-auth' ? 401 : expected === 'forbidden' ? 403 : row.key === 'POST /api/reports/pdf' || row.key === 'POST /api/reports/single-pdf' ? 202 : createdResponses.has(row.key) ? 201 : 200;
      expect(response.status, row.key + ' × ' + actor).toBe(wanted);
      if (row.key === 'GET /api/feedback/stream') { await response.body?.cancel(); return; }
      const bytes = await response.arrayBuffer();
      if (expected === 'allow') expect(bytes.byteLength, 'success contains data').toBeGreaterThan(0);
      if (row.key === 'GET /api/weather' && expected === 'allow') expect(JSON.parse(new TextDecoder().decode(bytes))).toMatchObject({windSpeed: 7, temperature: 10});
      if (row.key === 'POST /api/notifications/telegram/test' && expected === 'allow') expect(JSON.parse(new TextDecoder().decode(bytes)).ok).toBe(true);
      if (row.key === 'POST /api/orion/lead') expect((await db.owner.query('SELECT count(*)::int AS n FROM "OrionLead" WHERE name=$1 AND "isSpam"=false', [(body as {name: string}).name])).rows[0].n).toBe(1);
      if (actor === 'OTHER_TENANT_OPERATOR' || actor === 'OTHER_TENANT_ASSISTANT') {
        // FeedbackEvent is a deliberate platform-wide feed; other rows must
        // not disclose our A tenant IDs, even when they return 200 empty lists.
        if (!['GET /api/feedback/events', 'GET /api/dictionary/all'].includes(row.key)) expect(new TextDecoder().decode(bytes).includes(db.tenants[0]), 'no foreign tenant rows').toBe(false);
      }
    }, 40_000);
  }
  for (const actor of ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'] as const) it('foreign equipment details preserves owner platform-global contract × ' + actor, async () => {
    const foreign = db.id(db.tenants[1], 'Equipment');
    const response = await fetch(base + '/api/equipment/' + foreign + '/details', {headers: headersFor(actor)});
    // Owner contract: ADMIN/DISPATCHER are platform roles. A current-tenant
    // service filter or strict RLS conflict must remain an explicit red control.
    expect(response.status).toBe(actor === 'ADMIN' || actor === 'DISPATCHER' ? 200 : 403);
    expect((await response.text()).includes(foreign)).toBe(actor === 'ADMIN' || actor === 'DISPATCHER');
  });
  for (const actor of ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'] as const) it('report history preserves documented platform-global access and denies workers × ' + actor, async () => {
    const foreign = db.id(db.tenants[1], 'Report');
    const marker = 'G3 foreign audit ' + randomUUID();
    await insert('ReportAudit', {id: randomUUID(), reportId: foreign, actorId: db.id(db.tenants[1], 'User'), actorName: marker, actorRole: 'OPERATOR', action: 'created'});
    try {
      const response = await fetch(base + '/api/reports/' + foreign + '/history', {headers: headersFor(actor)});
      expect(response.status).toBe(actor === 'ADMIN' || actor === 'DISPATCHER' ? 200 : 403);
      const result = await response.text();
      expect(result.includes(marker)).toBe(actor === 'ADMIN' || actor === 'DISPATCHER');
    } finally { await db.owner.query('DELETE FROM "ReportAudit" WHERE "reportId"=$1 AND "actorName"=$2', [foreign, marker]); }
  });
});

describe.skipIf(!enabled)('G3 HTTP acting roles on actual disposable application', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let base: string;
  let cookie: string;
  let adminId: string;
  let typeId: string;
  const acceptedTelemetry: number[] = [];
  const deniedTelemetry: number[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.CODEX_STAND_URL || 'http://invalid');
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw new Error('Only owned local stand allowed');
    base = url.origin;
    fixture = await createFixture();
    const tenant = fixture.tenants[0];
    adminId = tenant + '-matrix-admin';
    typeId = tenant + '-matrix-doc-type';
    const email = adminId + '@example.invalid';
    const password = randomBytes(24).toString('hex');
    await fixture.owner.query('INSERT INTO "User" (id,"tenantId",email,password,name,role,"updatedAt") VALUES ($1,$2,$3,$4,$1,$5,now())', [adminId, tenant, email, await bcrypt.hash(password, 10), 'ADMIN']);
    await fixture.owner.query('INSERT INTO "UserDocumentType" (id,"tenantId",name,"normalizedName","requiresExpiry","updatedAt") VALUES ($1,$2,$1,$1,false,now())', [typeId, tenant]);
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.18.' + randomBytes(1).readUInt8(0) + '.' + randomBytes(1).readUInt8(0)}, body: JSON.stringify({email, password})});
    expect(response.status).toBe(200);
    cookie = response.headers.getSetCookie().find(value => value.startsWith('pt-session='))?.split(';')[0] || '';
    expect(cookie).not.toBe('');
  });
  afterAll(async () => {
    if (!fixture) return;
    try {
      try {
        // Observe the accepted buffered controls before removing fixture FK rows.
        const equipmentId = fixture.id(fixture.tenants[0], 'Equipment');
        if (acceptedTelemetry.length) {
          const deadline = Date.now() + 12_000;
          let stored = 0;
          do {
            stored = (await fixture.owner.query('SELECT count(*)::int AS n FROM "TelemetryRecord" WHERE "equipmentId"=$1 AND value=ANY($2::float8[])', [equipmentId, acceptedTelemetry])).rows[0].n;
            if (stored === acceptedTelemetry.length) break;
            await new Promise(resolve => setTimeout(resolve, 250));
          } while (Date.now() < deadline);
          expect(stored, 'accepted telemetry controls persisted before cleanup').toBe(acceptedTelemetry.length);
          expect((await fixture.owner.query('SELECT count(*)::int AS n FROM "TelemetryRecord" WHERE "equipmentId"=$1 AND value=ANY($2::float8[])', [equipmentId, deniedTelemetry])).rows[0].n).toBe(0);
        }
      } finally {
        await fixture.owner.query('DELETE FROM "TelemetryRecord" WHERE "equipmentId"=$1', [fixture.id(fixture.tenants[0], 'Equipment')]);
        await fixture.owner.query('DELETE FROM "UserDocument" WHERE "tenantId"=$1', [fixture.tenants[0]]);
        await fixture.owner.query('DELETE FROM "UserDocumentType" WHERE id=$1', [typeId]);
        await fixture.owner.query('DELETE FROM "User" WHERE id=$1', [adminId]);
      }
    } finally { await fixture.close(); }
  });

  for (const role of ['FOREMAN', 'SAFETY_ENGINEER']) it(role + ' cannot create another employee document through ADMIN acting role', async () => {
    const employeeId = fixture.id(fixture.tenants[0], 'User');
    const marker = 'G3-acting-' + randomUUID();
    const request = (actingAs?: string) => fetch(base + '/api/users/' + employeeId + '/documents', {
      method: 'POST', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...(actingAs ? {'x-acting-as': actingAs} : {})},
      body: JSON.stringify({typeId, notes: marker}),
    });
    const allowed = await request();
    expect(allowed.status).toBe(201);
    const count = async () => (await fixture.owner.query('SELECT count(*)::int AS n FROM "UserDocument" WHERE "tenantId"=$1 AND notes=$2', [fixture.tenants[0], marker])).rows[0].n;
    expect(await count()).toBe(1);
    await fixture.owner.query('DELETE FROM "UserDocument" WHERE "tenantId"=$1 AND notes=$2', [fixture.tenants[0], marker]);
    const denied = await request(role);
    expect(denied.status).toBe(403);
    expect(await count()).toBe(0);
  });
  it('FOREMAN cannot access document control, SAFETY_ENGINEER can', async () => {
    for (const [actingAs, expected] of [['FOREMAN', 403], ['SAFETY_ENGINEER', 200]] as const) {
      const response = await fetch(base + '/api/user-documents/control', {headers: {Cookie: cookie, 'x-acting-as': actingAs}});
      expect(response.status).toBe(expected);
    }
  });
  for (const role of ['FOREMAN', 'SAFETY_ENGINEER']) for (const method of ['PUT', 'DELETE']) it(role + ' cannot ' + method + ' another employee document through ADMIN acting role', async () => {
    const tenant = fixture.tenants[0];
    const employeeId = fixture.id(tenant, 'User');
    const id = tenant + '-matrix-' + randomUUID();
    const seed = () => fixture.owner.query('INSERT INTO "UserDocument" (id,"tenantId","userId","typeId",notes,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [id, tenant, employeeId, typeId, 'unchanged']);
    await seed();
    const request = (actingAs?: string) => fetch(base + '/api/users/' + employeeId + '/documents/' + id, {
      method, headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...(actingAs ? {'x-acting-as': actingAs} : {})},
      body: JSON.stringify(method === 'PUT' ? {notes: 'edited'} : {}),
    });
    expect((await request()).status).toBe(200);
    if (method === 'DELETE') await seed();
    else await fixture.owner.query('UPDATE "UserDocument" SET notes=$1 WHERE id=$2', ['unchanged', id]);
    expect((await request(role)).status).toBe(403);
    expect((await fixture.owner.query('SELECT notes FROM "UserDocument" WHERE id=$1', [id])).rows).toEqual([{notes: 'unchanged'}]);
  });
  for (const role of ['FOREMAN', 'SAFETY_ENGINEER']) for (const path of ['/api/telemetry', '/api/telemetry/batch']) it(role + ' cannot ingest telemetry through ADMIN acting role: ' + path, async () => {
    const equipmentId = fixture.id(fixture.tenants[0], 'Equipment');
    const record = {type: 'temperature', equipmentId, value: Number.parseInt(randomBytes(3).toString('hex'), 16), timestamp: new Date().toISOString()};
    const body = path.endsWith('batch') ? [record] : record;
    const send = (actingAs?: string) => fetch(base + path, {method: 'POST', headers: {Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...(actingAs ? {'x-acting-as': actingAs} : {})}, body: JSON.stringify(body)});
    expect((await send()).status).toBe(200);
    acceptedTelemetry.push(record.value);
    record.value = 100_000 + Number.parseInt(randomBytes(3).toString('hex'), 16);
    deniedTelemetry.push(record.value);
    expect((await send(role)).status).toBe(403);
    // A unique denied value distinguishes it from the earlier accepted buffered control.
    expect((await fixture.owner.query('SELECT count(*)::int AS n FROM "TelemetryRecord" WHERE "equipmentId"=$1 AND value=$2', [equipmentId, record.value])).rows[0].n).toBe(0);
  });
});
