const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { hashSync } = require('bcryptjs');

const projectRoot = process.cwd();
const sourceDbPath = path.join(projectRoot, 'db', 'custom.db');
const tempDbName = `smoke-${Date.now()}.db`;
const tempDbPath = path.join(projectRoot, 'db', tempDbName);
const tempDatabaseUrl = `file:${tempDbPath.replace(/\\/g, '/')}`;
const baseUrl = 'http://127.0.0.1:3101';

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

async function createFixtures(databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ log: ['error'] });
  const suffix = Date.now().toString();

  try {
    const admin = await prisma.user.create({
      data: {
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
      foreignReport,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source database not found: ${sourceDbPath}`);
  }

  fs.copyFileSync(sourceDbPath, tempDbPath);

  const fixtures = await createFixtures(tempDatabaseUrl);
  const server = spawn('node', ['.next/standalone/server.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '3101',
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_URL: tempDatabaseUrl,
      SESSION_SECRET: 'smoke-test-session-secret',
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
    assert.equal(result.body.diagnostics.databaseProvider, 'sqlite', 'Diagnostics must expose runtime provider');
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
      headers: { cookie: adminJar.header() },
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
      fs.unlinkSync(tempDbPath);
    } catch {}
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
