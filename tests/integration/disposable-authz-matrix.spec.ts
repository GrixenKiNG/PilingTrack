import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createFixture } from './helpers/disposable-db';
import { apiRouteInventory, inventoryDifference } from './helpers/authz-route-inventory';
import { AUTHZ_ACTORS, authzRouteManifest, type AuthzActor } from './authz-route-manifest';

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
const pendingReads = new Set([
  'GET /api/weather',
]);
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
]);

const createdResponses = new Set([
  'POST /api/user-document-types', 'POST /api/users/[id]/documents', 'POST /api/briefings',
  'POST /api/checklist-templates', 'POST /api/equipment', 'POST /api/sites/create',
  'POST /api/equipment/[id]/documents', 'POST /api/equipment/[id]/fuel',
  'POST /api/equipment/[id]/meter-readings', 'POST /api/equipment/[id]/maintenance',
  'POST /api/maintenance-plans', 'POST /api/readiness/defects', 'POST /api/safety/equipment-permits',
]);

describe.skipIf(!enabled)('G3 HTTP authorization matrix: nine actors × every API method', () => {
  let db: Awaited<ReturnType<typeof createFixture>>;
  let base: string;
  const identities = new Map<string, {id: string; tenant: string; email: string; password: string; cookie: string}>();
  const insert = async (table: string, values: Record<string, unknown>) => {
    const fields = Object.keys(values);
    if (![table, ...fields].every(value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value))) throw new Error('Invalid fixture identifier');
    await db.owner.query('INSERT INTO "' + table + '" (' + fields.map(field => '"' + field + '"').join(',') + ') VALUES (' + fields.map((_, index) => '$' + (index + 1)).join(',') + ')', Object.values(values));
    return values.id as string;
  };
  const actorIdentity = (actor: AuthzActor) => identities.get(actor.startsWith('ADMIN_AS_') ? 'ADMIN' : actor === 'UNAUTHENTICATED' ? 'OPERATOR' : actor)!;
  const headersFor = (actor: AuthzActor): Record<string, string> => ({
    Origin: base, 'Content-Type': 'application/json',
    ...(actor === 'UNAUTHENTICATED' ? {} : {Cookie: actorIdentity(actor).cookie}),
    ...(actor.startsWith('ADMIN_AS_') ? {'x-acting-as': actor.slice('ADMIN_AS_'.length)} : {}),
  });
  const logIn = async (identity: {email: string; password: string}) => {
    const result = await fetch(base + '/api/auth/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({email: identity.email, password: identity.password})});
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
    const password = randomBytes(24).toString('hex');
    const hash = await bcrypt.hash(password, 10);
    for (const category of ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'OTHER_TENANT_OPERATOR', 'OTHER_TENANT_ASSISTANT']) {
      const tenant = db.tenants[category.startsWith('OTHER_TENANT_') ? 1 : 0];
      const role = category.replace('OTHER_TENANT_', '');
      const id = role === 'OPERATOR' ? db.id(tenant, 'User') : db.id(tenant, 'matrix-' + role);
      const email = id + '@example.invalid';
      await db.owner.query('INSERT INTO "User" (id,"tenantId",email,password,name,role,"updatedAt") VALUES ($1,$2,$3,$4,$1,$5,now()) ON CONFLICT (id) DO UPDATE SET password=$4,role=$5', [id, tenant, email, hash, role]);
      const identity = {id, tenant, email: role === 'OPERATOR' ? tenant + '@example.invalid' : email, password, cookie: ''};
      identity.cookie = await logIn(identity);
      identities.set(category, identity);
    }
    for (const tenant of db.tenants) {
      await db.owner.query('INSERT INTO "Crew" (id,"operatorId","equipmentId","siteId","updatedAt") VALUES ($1,$2,$3,$4,now())', [db.id(tenant, 'Crew'), db.id(tenant, 'User'), db.id(tenant, 'Equipment'), db.id(tenant, 'Site')]);
      const assistant = [...identities.values()].find(identity => identity.tenant === tenant && identity.id.endsWith('matrix-assistant'))!;
      await db.owner.query('INSERT INTO "CrewAssistant" (id,"crewId","userId",name,"updatedAt") VALUES ($1,$2,$3,$1,now())', [db.id(tenant, 'CrewAssistant'), db.id(tenant, 'Crew'), assistant.id]);
      await db.owner.query('INSERT INTO "UserSiteAssignment" (id,"userId","siteId","updatedAt") VALUES ($1,$2,$3,now())', [db.id(tenant, 'assignment'), db.id(tenant, 'User'), db.id(tenant, 'Site')]);
      await db.owner.query('INSERT INTO "UserDocumentType" (id,"tenantId",name,"normalizedName","requiresExpiry","updatedAt") VALUES ($1,$2,$1,$1,false,now())', [db.id(tenant, 'type'), tenant]);
      await db.owner.query('INSERT INTO "Media" (id,"tenantId","userId","entityType","entityId","fileName","contentType",key,"uploadStatus","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [db.id(tenant, 'Media'), tenant, db.id(tenant, 'User'), 'equipment', db.id(tenant, 'Equipment'), 'matrix.pdf', 'application/pdf', tenant + '/matrix.pdf', 'completed']);
      await insert('MaintenanceRecord', {id: db.id(tenant, 'MaintenanceRecord'), tenantId: tenant, equipmentId: db.id(tenant, 'Equipment'), type: 'TO1', title: 'G3 matrix', updatedAt: new Date()});
      await insert('ShiftHandover', {id: db.id(tenant, 'ShiftHandover'), tenantId: tenant, shiftId: db.id(tenant, 'Shift'), summary: 'G3 matrix', submittedById: db.id(tenant, 'User'), updatedAt: new Date()});
      await insert('WorkPermit', {id: db.id(tenant, 'WorkPermit'), tenantId: tenant, equipmentId: db.id(tenant, 'Equipment'), risk: 'NORMAL', scope: 'G3 matrix', validFrom: new Date(), validTo: new Date(Date.now() + 86400_000), timezone: 'Europe/Moscow', authorId: db.id(tenant, 'User'), lastEditedById: db.id(tenant, 'User'), updatedAt: new Date()});
    }
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    try {
      // Only rows belonging to the two random tenants created by this suite.
      // Discover FK order instead of maintaining a fragile schema-wide delete list.
      const tables = (await db.owner.query('SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name=$2', ['public', 'tenantId'])).rows.map(row => row.table_name as string);
      let pending = tables;
      for (let attempt = 0; pending.length && attempt < tables.length; attempt++) {
        const remaining: string[] = [];
        for (const table of pending) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Unexpected table identifier');
          try { await db.owner.query('DELETE FROM "' + table + '" WHERE "tenantId"=ANY($1::text[])', [db.tenants]); }
          catch (error) { if ((error as {code?: string}).code !== '23503') throw error; remaining.push(table); }
        }
        if (remaining.length === pending.length) throw new Error('Owned fixture cleanup blocked by foreign keys: ' + remaining.join(','));
        pending = remaining;
      }
      for (const tenant of db.tenants) await db.owner.query('DELETE FROM "Tenant" WHERE id=$1', [tenant]);
    } finally { await Promise.all([db.app.end(), db.owner.end()]); }
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
        const original = await fetch(base + path, {headers: headersFor(actor)});
        expect(original.status, 'valid saved template control').toBe(200);
        body = await original.json();
      }
      if (template === '/api/media') body = {fileName: 'matrix.pdf', contentType: 'application/pdf', fileSize: 1, entityType: 'equipment', entityId: equipment};
      if (template === '/api/feedback/events') body = {operation: 'read_all'};
      if (template === '/api/briefings/[id]/sign') {
        const instructor = identities.get('ADMIN')!.id;
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
      if (template === '/api/reports/admin-upsert') body = {reportId: randomUUID(), siteId: db.id(tenant, 'Site'), userId: operator, date: '2026-10-02', piles: [], drillings: [], downtimes: []};
      if (template === '/api/reports/pdf') body = {dateFrom: '2026-10-02', dateTo: '2026-10-02', siteId: db.id(tenant, 'Site')};
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
      if (template.startsWith('/api/readiness/work-permits/')) body = template.endsWith('/revoke') ? {expectedVersion: 1, reason: name} : method === 'PATCH' ? {expectedVersion: 1, title: name} : {expectedVersion: 1};
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
      const response = await fetch(base + path, {method, headers, body: method === 'GET' ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000)});
      const wanted = expected === 'unauthenticated' || expected === 'service-auth' ? 401 : expected === 'forbidden' ? 403 : row.key === 'POST /api/reports/pdf' || row.key === 'POST /api/reports/single-pdf' ? 202 : createdResponses.has(row.key) ? 201 : 200;
      expect(response.status, row.key + ' × ' + actor).toBe(wanted);
      if (row.key === 'GET /api/feedback/stream') { await response.body?.cancel(); return; }
      const bytes = await response.arrayBuffer();
      if (expected === 'allow') expect(bytes.byteLength, 'success contains data').toBeGreaterThan(0);
      if (actor === 'OTHER_TENANT_OPERATOR' || actor === 'OTHER_TENANT_ASSISTANT') {
        // FeedbackEvent is a deliberate platform-wide feed; other rows must
        // not disclose our A tenant IDs, even when they return 200 empty lists.
        if (!['GET /api/feedback/events', 'GET /api/dictionary/all'].includes(row.key)) expect(new TextDecoder().decode(bytes).includes(db.tenants[0]), 'no foreign tenant rows').toBe(false);
      }
    }, 40_000);
  }
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
    const response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password})});
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
