const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { hashSync } = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const projectRoot = process.cwd();
const baseUrl = 'http://127.0.0.1:3101';
const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const fallback = headers.get('set-cookie');
  return fallback ? [fallback] : [];
}

function createCookieJar() {
  const cookies = new Map();

  return {
    apply(headers) {
      const setCookies = getSetCookieValues(headers);

      for (const cookie of setCookies) {
        const [pair] = cookie.split(';');
        const separatorIndex = pair.indexOf('=');
        const name = pair.slice(0, separatorIndex).trim();
        const value = pair.slice(separatorIndex + 1).trim();

        if (!value) {
          cookies.delete(name);
        } else {
          cookies.set(name, value);
        }
      }
    },
    header() {
      return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    },
  };
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const { response, body } = await request('/api');
      if (response.ok && body.status === 'ok') {
        return;
      }
    } catch {}

    await delay(500);
  }

  throw new Error('Standalone server did not become ready in time');
}

function getPrismaClient() {
  const { PrismaClient } = require(path.join(projectRoot, 'src', 'generated', 'postgres-client'));
  const { PrismaPg } = require('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }), log: ['error'] });
}

async function createFixtures() {
  const prisma = getPrismaClient();
  const suffix = Date.now().toString();

  try {
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      throw new Error('No Tenant row found — smoke test requires at least one Tenant in the target database.');
    }
    const tenantId = tenant.id;

    const admin = await prisma.user.create({
      data: {
        tenantId,
        email: `smoke-admin-${suffix}@example.com`,
        password: hashSync('AdminPass123!', 10),
        name: 'Smoke Admin',
        role: 'ADMIN',
        phone: '+7-900-000-1001',
        isActive: true,
      },
    });

    const operator = await prisma.user.create({
      data: {
        tenantId,
        email: `smoke-operator-${suffix}@example.com`,
        password: hashSync('OperatorPass123!', 10),
        name: 'Smoke Operator',
        role: 'OPERATOR',
        phone: '+7-900-000-1002',
        isActive: true,
      },
    });

    const foreignOperator = await prisma.user.create({
      data: {
        tenantId,
        email: `smoke-foreign-${suffix}@example.com`,
        password: hashSync('ForeignPass123!', 10),
        name: 'Smoke Foreign Operator',
        role: 'OPERATOR',
        phone: '+7-900-000-1003',
        isActive: true,
      },
    });

    const site = await prisma.site.create({
      data: {
        tenantId,
        name: `Smoke Site ${suffix}`,
        plannedPiles: 1,
        plannedDrilling: 0,
        status: 'ACTIVE',
        isActive: true,
      },
    });

    await prisma.userSiteAssignment.create({
      data: {
        userId: operator.id,
        siteId: site.id,
      },
    });

    await prisma.userSiteAssignment.create({
      data: {
        userId: foreignOperator.id,
        siteId: site.id,
      },
    });

    const foreignReport = await prisma.report.create({
      data: {
        tenantId,
        reportId: `smoke-report-${suffix}`,
        userId: foreignOperator.id,
        siteId: site.id,
        date: '2026-04-04',
        shiftType: 'DAY',
        status: 'draft',
      },
    });

    return {
      admin,
      operator,
      foreignOperator,
      site,
      foreignReport,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupFixtures(fixtures) {
  const prisma = getPrismaClient();

  try {
    // Deleting the users/site cascades the report and assignment rows
    // (onDelete: Cascade on Report.user/site and UserSiteAssignment.user/site).
    await prisma.user.deleteMany({
      where: { id: { in: [fixtures.admin.id, fixtures.operator.id, fixtures.foreignOperator.id] } },
    });
    await prisma.site.delete({ where: { id: fixtures.site.id } });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!connectionString) {
    throw new Error('DATABASE_URL_POSTGRES (or DATABASE_URL) is required to run the smoke test.');
  }

  const fixtures = await createFixtures();
  const server = spawn('node', ['.next/standalone/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '3101',
      DATABASE_PROVIDER: 'postgres',
      DATABASE_URL_POSTGRES: connectionString,
      SESSION_SECRET: 'smoke-test-session-secret-minimum-32-characters',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStdErr = '';
  server.stderr.on('data', (chunk) => {
    serverStdErr += chunk.toString();
  });

  try {
    await waitForServer();

    const adminJar = createCookieJar();
    const operatorJar = createCookieJar();

    let result = await request('/api/ready');
    assert.equal(result.response.status, 200, 'Readiness endpoint must return 200 in smoke environment');
    assert.equal(result.body.ready, true, 'Readiness endpoint must report ready=true');
    assert.equal(
      typeof result.response.headers.get('x-request-id'),
      'string',
      'Readiness endpoint must return x-request-id header'
    );
    assert.equal(
      result.body.requestId,
      result.response.headers.get('x-request-id'),
      'Readiness response body must echo requestId'
    );

    result = await request('/api/auth/me');
    assert.equal(result.response.status, 401, 'Unauthenticated /api/auth/me must return 401');

    result = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: fixtures.admin.email,
        password: 'AdminPass123!',
      }),
    });
    assert.equal(result.response.status, 200, 'Admin login must succeed');
    assert.equal(
      typeof result.response.headers.get('x-request-id'),
      'string',
      'Login response must return x-request-id header'
    );
    adminJar.apply(result.response.headers);

    result = await request('/api/auth/me', {
      headers: { cookie: adminJar.header() },
    });
    assert.equal(result.response.status, 200, 'Authenticated /api/auth/me must return 200');
    assert.equal(result.body.user.email, fixtures.admin.email, 'Admin session must resolve correct user');

    result = await request('/api/users', {
      headers: { cookie: adminJar.header() },
    });
    assert.equal(result.response.status, 200, 'Admin must access /api/users');

    result = await request('/api/system', {
      headers: { cookie: adminJar.header() },
    });
    assert.equal(result.response.status, 200, 'Admin must access /api/system');
    assert.equal(result.body.diagnostics.databaseProvider, 'postgres', 'Diagnostics must expose runtime provider');
    assert.equal(
      result.body.requestId,
      result.response.headers.get('x-request-id'),
      'System diagnostics must echo requestId'
    );

    result = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: fixtures.operator.email,
        password: 'OperatorPass123!',
      }),
    });
    assert.equal(result.response.status, 200, 'Operator login must succeed');
    operatorJar.apply(result.response.headers);

    result = await request('/api/users', {
      headers: { cookie: operatorJar.header() },
    });
    assert.equal(result.response.status, 403, 'Operator must be forbidden from /api/users');

    result = await request(`/api/reports/single-pdf?reportId=${fixtures.foreignReport.reportId}`, {
      headers: { cookie: operatorJar.header() },
    });
    assert.equal(
      result.response.status,
      403,
      'Operator must be forbidden from reading another operator report PDF'
    );

    result = await request('/api/auth/logout', {
      method: 'POST',
      // Same-origin CSRF check (src/lib/csrf-protection.ts) rejects mutations
      // with no Origin/Referer/Sec-Fetch-Site — a plain Node fetch sends none.
      headers: { cookie: adminJar.header(), 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(result.response.status, 200, 'Logout must succeed');
    adminJar.apply(result.response.headers);

    result = await request('/api/auth/me', {
      headers: { cookie: adminJar.header() },
    });
    assert.equal(result.response.status, 401, 'Session must be cleared after logout');

    console.log('Smoke auth/access test passed.');
  } finally {
    server.kill('SIGTERM');
    await delay(500);

    if (!server.killed) {
      server.kill('SIGKILL');
    }

    if (server.exitCode && serverStdErr) {
      console.error(serverStdErr);
    }

    try {
      await cleanupFixtures(fixtures);
    } catch (cleanupError) {
      console.error('Fixture cleanup failed:', cleanupError instanceof Error ? cleanupError.message : cleanupError);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
