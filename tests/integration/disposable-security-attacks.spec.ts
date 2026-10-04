// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createFixture } from './helpers/disposable-db';

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.CODEX_STAND_URL);
const mutations = (dir: string): { method: string; route: string }[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  if (entry.isDirectory()) return mutations(file);
  if (entry.name !== 'route.ts') return [];
  const route = '/api/' + path.relative('src/app/api', path.dirname(file)).replaceAll('\\', '/');
  return [...readFileSync(file, 'utf8').matchAll(/export\s+(?:const|(?:async\s+)?function)\s+(POST|PUT|PATCH|DELETE)\b/g)].map(match => ({ method: match[1], route }));
});
const routes = mutations('src/app/api');
// These endpoints do not accept browser session cookies as authority. Keep
// explicit entries: a newly added route is tested for CSRF by default.
const cookieFree = new Map([
  ['/api/alerts/webhook', 401], // Independent Alertmanager shared secret.
  ['/api/telemetry/ingest', 401], // Independent X-Device-Key.
  ['/api/orion/lead', 400], // Public form; empty body cannot create a lead.
]);
const newIp = () => `127.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;

describe.skipIf(!enabled)('G3 security attacks on owned production app', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let base: string;
  const accounts: Record<string, { email: string; password: string; id: string }> = {};
  let adminCookie: string;
  let feedbackScope: string;
  const request = (route: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) => fetch(base + route, {
    method, redirect: 'manual', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': newIp(), ...headers },
    body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body ?? {}),
  });
  const login = async (account: { email: string; password: string }) => {
    const response = await request('/api/auth/login', 'POST', { Origin: base }, account);
    expect(response.status, 'fixture login').toBe(200);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('pt-session='))?.split(';')[0];
    if (!cookie) throw new Error('Fixture login did not issue session cookie');
    return cookie;
  };
  beforeAll(async () => {
    const url = new URL(process.env.CODEX_STAND_URL || 'http://invalid');
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw new Error('Owned local stand required');
    base = url.origin;
    fixture = await createFixture();
    feedbackScope = fixture.tenants[0] + '-g3-feedback';
    for (const role of ['ADMIN', 'OPERATOR']) {
      const tenant = fixture.tenants[0];
      accounts[role] = { email: tenant + '-' + role.toLowerCase() + '@example.invalid', password: randomBytes(20).toString('hex'), id: role === 'ADMIN' ? fixture.id(tenant, 'User') : tenant + '-security-user' };
      const hash = await bcrypt.hash(accounts[role].password, 10);
      if (role === 'ADMIN') await fixture.owner.query('UPDATE "User" SET email=$1,password=$2,role=$3 WHERE id=$4', [accounts[role].email, hash, role, accounts[role].id]);
      else await fixture.owner.query('INSERT INTO "User" (id,"tenantId",email,password,name,role,"updatedAt") VALUES ($1,$2,$3,$4,$1,$5,now())', [accounts[role].id, tenant, accounts[role].email, hash, role]);
    }
    adminCookie = await login(accounts.ADMIN);
  });
  afterAll(async () => {
    if (!fixture) return;
    try {
      const actors = Object.values(accounts).map(account => account.id);
      await fixture.owner.query('DELETE FROM "FeedbackEventRead" WHERE "eventId" IN (SELECT id FROM "FeedbackEvent" WHERE scope=$1 AND "actorId"=ANY($2::text[]))', [feedbackScope, actors]);
      await fixture.owner.query('DELETE FROM "FeedbackEvent" WHERE scope=$1 AND "actorId"=ANY($2::text[])', [feedbackScope, actors]);
      if (accounts.OPERATOR) await fixture.owner.query('DELETE FROM "User" WHERE id=$1', [accounts.OPERATOR.id]);
    }
    finally { await fixture.close(); }
  });

  it('rejects a different scheme in Origin before accepting valid login credentials', async () => {
    const wrongScheme = new URL(base); wrongScheme.protocol = wrongScheme.protocol === 'http:' ? 'https:' : 'http:';
    const response = await request('/api/auth/login', 'POST', { Origin: wrongScheme.origin }, accounts.OPERATOR);
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().some(value => value.startsWith('pt-session='))).toBe(false);
    expect((await request('/api/auth/me', 'GET', { Cookie: await login(accounts.OPERATOR) })).status).toBe(200);
  });
  it('rejects a different scheme in Referer when Origin is absent', async () => {
    const wrongScheme = new URL(base); wrongScheme.protocol = wrongScheme.protocol === 'http:' ? 'https:' : 'http:';
    const response = await request('/api/auth/login', 'POST', { Referer: wrongScheme.origin + '/login' }, accounts.OPERATOR);
    expect(response.status).toBe(403);
  });
  it('accepts HTTPS Origin with trusted proxy protocol headers', async () => {
    const httpsOrigin = new URL(base); httpsOrigin.protocol = 'https:';
    const response = await request('/api/auth/login', 'POST', { Origin: httpsOrigin.origin, 'X-Forwarded-Proto': 'https' }, accounts.OPERATOR);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some(value => value.startsWith('pt-session='))).toBe(true);
  });
  it('rejects the HTTP origin when the trusted proxy reports HTTPS', async () => {
    const httpOrigin = new URL(base); httpOrigin.protocol = 'http:';
    const response = await request('/api/auth/login', 'POST', { Origin: httpOrigin.origin, 'X-Forwarded-Proto': 'https' }, accounts.OPERATOR);
    expect(response.status).toBe(403);
  });

  for (const { method, route } of routes) it(`CSRF ${method} ${route}`, async () => {
    const concrete = route.replace(/\[\[?\.?\.?(?:[^\]]+)\]\]?/g, 'codex-missing-' + randomUUID());
    if (cookieFree.has(route)) {
      // An authenticated browser cookie alone must not authorize machine APIs.
      expect((await request(concrete, method, { Cookie: adminCookie, Origin: 'https://evil.example' })).status).toBe(cookieFree.get(route));
      return;
    }
    for (const attack of [
      { Origin: 'https://evil.example' }, { Origin: 'null' },
      { Referer: 'https://evil.example/form' }, { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: base, 'Sec-Fetch-Site': 'same-site' }, {},
    ]) {
      const response = await request(concrete, method, { Cookie: adminCookie, ...attack });
      // Headerless script login is intentionally supported; no browser can
      // forge it without Origin/Referer/Sec-Fetch-Site. Other mutations reject.
      const headerlessLogin = route === '/api/auth/login' && Object.keys(attack).length === 0;
      expect(response.status, `${method} ${route}: ${Object.keys(attack).join(',')}`).toBe(headerlessLogin ? 400 : 403);
      if (!headerlessLogin) expect((await response.json()).error).toMatch(/CSRF/i);
    }
  });

  it('logout revokes the exact token for cookie, Bearer and a previously cached GET', async () => {
    const cookie = await login(accounts.OPERATOR);
    expect((await request('/api/equipment', 'GET', { Cookie: cookie })).status).toBe(200);
    expect((await request('/api/auth/logout', 'POST', { Cookie: cookie, Origin: base })).status).toBe(200);
    for (const headers of [{ Cookie: cookie }, { Authorization: 'Bearer ' + cookie.slice('pt-session='.length) }]) {
      for (const route of ['/api/auth/me', '/api/equipment']) expect((await request(route, 'GET', headers)).status).toBe(401);
    }
    expect((await request('/api/auth/me', 'GET', { Cookie: await login(accounts.OPERATOR) })).status).toBe(200);
  });
  it('password change invalidates two active sessions, including warmed cached responses', async () => {
    const cookies = [await login(accounts.OPERATOR), await login(accounts.OPERATOR)];
    for (const cookie of cookies) expect((await request('/api/equipment', 'GET', { Cookie: cookie })).status).toBe(200);
    const password = randomBytes(20).toString('hex');
    expect((await request('/api/users', 'PUT', { Cookie: adminCookie, Origin: base }, { id: accounts.OPERATOR.id, password })).status).toBe(200);
    expect((await fixture.owner.query('SELECT "sessionVersion" FROM "User" WHERE id=$1', [accounts.OPERATOR.id])).rows[0].sessionVersion).toBe(1);
    for (const cookie of cookies) for (const headers of [{ Cookie: cookie }, { Authorization: 'Bearer ' + cookie.slice('pt-session='.length) }]) {
      for (const route of ['/api/auth/me', '/api/equipment']) expect((await request(route, 'GET', headers)).status).toBe(401);
    }
    expect((await request('/api/auth/login', 'POST', { Origin: base }, accounts.OPERATOR)).status).toBe(401);
    accounts.OPERATOR.password = password;
    expect((await request('/api/auth/me', 'GET', { Cookie: await login(accounts.OPERATOR) })).status).toBe(200);
  });
  it('rejects tampered identity, role, tenant, version, unsigned JWT and malformed token', async () => {
    const token = (await login(accounts.OPERATOR)).slice('pt-session='.length);
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const forged = [{ role: 'ADMIN' }, { sub: accounts.ADMIN.id }, { tenantId: fixture.tenants[1] }, { sv: 999 }].map(change =>
      [parts[0], Buffer.from(JSON.stringify({ ...payload, ...change })).toString('base64url'), parts[2]].join('.'));
    forged.push(Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url') + '.' + parts[1] + '.', 'invalid');
    for (const value of forged) for (const headers of [{ Cookie: 'pt-session=' + value }, { Authorization: 'Bearer ' + value }]) {
      expect((await request('/api/auth/me', 'GET', headers)).status).toBe(401);
    }
  });

  it('account lockout survives rotating IP, email case and client tenant/role headers', async () => {
    const email = accounts.ADMIN.email;
    for (let index = 0; index < 11; index++) {
      const response = await request('/api/auth/login', 'POST', { Origin: base, 'x-tenant-id': randomUUID(), 'x-acting-as': randomUUID() }, { email: index % 2 ? email.toUpperCase() : email, password: index === 10 ? accounts.ADMIN.password : 'wrong-password' });
      expect(response.status).toBe(index < 10 ? 401 : 429);
      if (index === 10) expect((await response.json()).retryAfter).toBeGreaterThan(0);
    }
  });
  it('IP limit survives rotating email, tenant, role and Bearer headers', async () => {
    const ip = newIp();
    for (let index = 0; index < 21; index++) {
      const response = await request('/api/auth/login', 'POST', { Origin: base, 'x-forwarded-for': ip, 'x-tenant-id': randomUUID(), 'x-acting-as': randomUUID(), Authorization: 'Bearer ' + randomUUID() }, { email: randomUUID() + '@example.invalid', password: 'wrong-password' });
      expect(response.status).toBe(index < 20 ? 401 : 429);
    }
  });
  it('mutation session limit survives changing acting-as and tenant headers', async () => {
    const ip = newIp(); const cookie = await login(accounts.OPERATOR);
    for (let index = 0; index < 101; index++) {
      const response = await request('/api/users', 'POST', { Origin: base, Cookie: cookie, 'x-forwarded-for': ip, 'x-acting-as': randomUUID(), 'x-tenant-id': randomUUID() });
      expect(response.status).toBe(index < 100 ? 403 : 429);
    }
  });
  it('source limit caps random unverified Bearer tokens across mutation routes', async () => {
    const ip = newIp(); let denied = 0;
    // Parallel batches finish within the one-minute window without flooding
    // another stand: every request uses our unique source bucket and no user.
    for (let offset = 0; offset < 1801; offset += 32) {
      const statuses = await Promise.all(Array.from({ length: Math.min(32, 1801 - offset) }, async (_, index) => {
        const route = (offset + index) % 2 ? '/api/users' : '/api/equipment';
        const response = await request(route, 'POST', { Origin: base, 'x-forwarded-for': ip, Authorization: 'Bearer ' + randomUUID() });
        await response.arrayBuffer(); return response.status;
      }));
      for (const status of statuses) { expect([401, 429]).toContain(status); if (status === 429) denied++; }
    }
    expect(denied).toBeGreaterThanOrEqual(1);
  }, 120_000);

  describe('G3 feedback acting-role authority', () => {
    const createEvent = async (actingAs?: string) => {
      const response = await request('/api/feedback/events', 'POST', { Cookie: adminCookie, Origin: base, ...(actingAs ? { 'x-acting-as': actingAs } : {}) }, {
        audience: 'ALL', scope: feedbackScope, title: 'Codex acting-role ' + randomUUID(), message: 'Owned disposable authority fixture',
      });
      expect(response.status).toBe(201);
      return (await response.json()).event as { id: string; audience: string };
    };
    for (const role of ['FOREMAN', 'SAFETY_ENGINEER']) {
      it(role + ' cannot acknowledge feedback using the underlying ADMIN privilege', async () => {
        const event = await createEvent();
        const acknowledge = (actingAs?: string) => request('/api/feedback/events', 'POST', { Cookie: adminCookie, Origin: base, ...(actingAs ? { 'x-acting-as': actingAs } : {}) }, { operation: 'acknowledge', eventId: event.id });
        expect((await acknowledge()).status).toBe(200);
        expect((await fixture.owner.query('SELECT "acknowledgedAt" IS NOT NULL AS acknowledged FROM "FeedbackEventRead" WHERE "eventId"=$1 AND "userId"=$2', [event.id, accounts.ADMIN.id])).rows).toEqual([{ acknowledged: true }]);
        await fixture.owner.query('DELETE FROM "FeedbackEventRead" WHERE "eventId"=$1 AND "userId"=$2', [event.id, accounts.ADMIN.id]);
        expect((await acknowledge(role)).status).toBe(403);
        expect((await fixture.owner.query('SELECT count(*)::int AS n FROM "FeedbackEventRead" WHERE "eventId"=$1 AND "userId"=$2', [event.id, accounts.ADMIN.id])).rows[0].n).toBe(0);
      });
      it(role + ' creates only USER audience feedback while ADMIN can publish ALL', async () => {
        expect((await createEvent()).audience).toBe('ALL');
        const event = await createEvent(role);
        expect(event.audience).toBe('USER');
        expect((await fixture.owner.query('SELECT audience FROM "FeedbackEvent" WHERE id=$1 AND scope=$2', [event.id, feedbackScope])).rows).toEqual([{ audience: 'USER' }]);
      });
      it(role + ' cannot read another employee private USER feedback through ADMIN authority', async () => {
        const id = fixture.tenants[0] + '-private-' + randomUUID();
        await fixture.owner.query('INSERT INTO "FeedbackEvent" (id,scope,action,title,message,audience,"actorId") VALUES ($1,$2,$3,$1,$1,$4,$5)', [id, feedbackScope, 'codex.feedback.private', 'USER', accounts.OPERATOR.id]);
        const list = async (actingAs?: string) => {
          const response = await request('/api/feedback/events?limit=100', 'GET', { Cookie: adminCookie, ...(actingAs ? { 'x-acting-as': actingAs } : {}) });
          expect(response.status).toBe(200);
          return (await response.json()).events as { id: string }[];
        };
        // Bust the warmed feed by creating an independent valid public control.
        // The private fixture is from another account in this same organization.
        await createEvent();
        expect((await list()).some(event => event.id === id)).toBe(true);
        expect((await list(role)).some(event => event.id === id)).toBe(false);
      });
    }
  });
});
