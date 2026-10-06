/**
 * POST /api/alerts/webhook — token auth regression (constant-time compare).
 *
 * Pins functional behavior around the timing-safe-equal refactor: still
 * accepts via Bearer header or ?token= query, still rejects mismatches and
 * a misconfigured (missing) env token. Timing safety itself isn't
 * meaningfully unit-testable — this just guards against breaking auth while
 * fixing the side-channel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  sendAlert: vi.fn().mockResolvedValue(true),
  enabled: vi.fn().mockResolvedValue(true),
  create: vi.fn(), upsert: vi.fn(), find: vi.fn(), update: vi.fn(),
  rows: new Map<string, { id: string; tenantId: string; published: boolean; payload: Record<string, unknown>; lastError: string | null }>(),
}));

vi.mock('@/core/notifications/telegram', () => ({
  telegramNotifier: { sendAlert: mocks.sendAlert },
}));
vi.mock('@/lib/db', () => {
  const outboxEvent = { create: mocks.create, upsert: mocks.upsert, findFirst: mocks.find, update: mocks.update };
  return { db: { outboxEvent, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ outboxEvent, $queryRaw: vi.fn() }) } };
});
vi.mock('@/modules/settings', () => ({ isNotificationEnabled: mocks.enabled }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';

const TOKEN = 'super-secret-webhook-token';

beforeEach(() => {
  vi.stubEnv('DEFAULT_TENANT_ID', 'test-tenant');
  mocks.rows.clear(); mocks.sendAlert.mockReset().mockResolvedValue(true); mocks.enabled.mockReset().mockResolvedValue(true);
  mocks.upsert.mockReset().mockImplementation(async ({ create }) => {
    const key = create.tenantId + ':' + create.dedupeKey;
    if (!mocks.rows.has(key)) mocks.rows.set(key, { ...create, id: key, published: false, lastError: null });
    return mocks.rows.get(key);
  });
  mocks.create.mockReset().mockImplementation(async ({ data }) => {
    const key = data.tenantId + ':' + data.dedupeKey;
    const row = { ...data, id: key, published: false, lastError: null };
    mocks.rows.set(key, row); return row;
  });
  mocks.find.mockReset().mockImplementation(async ({ where }) => [...mocks.rows.values()].find(row => row.id === where.id && row.tenantId === where.tenantId));
  mocks.update.mockReset().mockImplementation(async ({ where, data }) => {
    const row = [...mocks.rows.values()].find(item => item.id === where.id);
    if (!row) throw new Error('row missing'); Object.assign(row, data); return row;
  });
});
afterEach(() => vi.unstubAllEnvs());


function reqWithHeader(token: string | null): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/alerts/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify({ alerts: [] }),
  });
}

function reqWithQuery(token: string): NextRequest {
  return new NextRequest(`http://localhost/api/alerts/webhook?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ alerts: [] }),
  });
}

function reqWithBody(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/alerts/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/alerts/webhook — auth', () => {
  const originalEnv = process.env.ALERTMANAGER_WEBHOOK_TOKEN;

  beforeEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = TOKEN;
  });
  afterEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = originalEnv;
  });

  it('accepts a matching Bearer token', async () => {
    const res = await POST(reqWithHeader(TOKEN));
    expect(res.status).toBe(200);
  });

  it('accepts a matching ?token= query param', async () => {
    const res = await POST(reqWithQuery(TOKEN));
    expect(res.status).toBe(200);
  });

  it('rejects a mismatched token', async () => {
    const res = await POST(reqWithHeader('wrong-token'));
    expect(res.status).toBe(401);
  });

  it('rejects a token of different length (constant-time path still correct)', async () => {
    const res = await POST(reqWithHeader('short'));
    expect(res.status).toBe(401);
  });

  it('rejects when no token is provided', async () => {
    const res = await POST(reqWithHeader(null));
    expect(res.status).toBe(401);
  });

  it('rejects everything when ALERTMANAGER_WEBHOOK_TOKEN is unset (fail closed)', async () => {
    delete process.env.ALERTMANAGER_WEBHOOK_TOKEN;
    const res = await POST(reqWithHeader(TOKEN));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/alerts/webhook — payload validation', () => {
  const originalEnv = process.env.ALERTMANAGER_WEBHOOK_TOKEN;

  beforeEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = TOKEN;
  });
  afterEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = originalEnv;
  });

  it('rejects a null body with 400 Некорректные данные', async () => {
    const res = await POST(reqWithBody(null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Некорректные данные' });
  });

  it('rejects an alert missing labels/annotations with 400', async () => {
    const res = await POST(reqWithBody({ alerts: [{ status: 'firing' }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Некорректные данные' });
  });

  it('rejects a non-string labels.severity with 400', async () => {
    const res = await POST(reqWithBody({
      alerts: [{ status: 'firing', labels: { severity: 5 }, annotations: {} }],
    }));
    expect(res.status).toBe(400);
  });

  it('I08: keeps the tail over 100 queued and forwards only the remaining alert on retry', async () => {
    const alerts = Array.from({ length: 101 }, (_, index) => ({
      status: 'firing', startsAt: '2026-10-02T00:00:00Z',
      labels: { alertname: 'alert-' + index },
      annotations: {},
    }));
    const res = await POST(reqWithBody({ alerts }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, forwarded: 100 });
    expect(mocks.rows.size).toBe(101);
    mocks.sendAlert.mockClear();
    const retry = await POST(reqWithBody({ alerts }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, forwarded: 101 });
    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid firing alert and forwards it', async () => {
    const res = await POST(reqWithBody({
      alerts: [{ status: 'firing', labels: { severity: 'high', alertname: 'rule-1' }, annotations: { summary: 'High CPU' } }],
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, forwarded: 1 });
  });
});

describe('POST /api/alerts/webhook — notification switch', () => {
  const originalEnv = process.env.ALERTMANAGER_WEBHOOK_TOKEN;

  beforeEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = TOKEN;
    mocks.enabled.mockResolvedValue(true);
    mocks.sendAlert.mockClear();
  });
  afterEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = originalEnv;
  });

  const firing = {
    alerts: [{ status: 'firing', labels: { severity: 'critical', alertname: 'rule-1' }, annotations: { summary: 'Disk full' } }],
  };

  it('forwards nothing while the systemAlerts switch is off, still answering 200', async () => {
    mocks.enabled.mockResolvedValueOnce(false);
    const res = await POST(reqWithBody(firing));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, forwarded: 0, reason: 'disabled' });
    expect(mocks.sendAlert).not.toHaveBeenCalled();
  });

  it('forwards again once the switch is back on', async () => {
    const res = await POST(reqWithBody(firing));
    expect(await res.json()).toEqual({ ok: true, forwarded: 1 });
    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/alerts/webhook — delivery failure', () => {
  const originalEnv = process.env.ALERTMANAGER_WEBHOOK_TOKEN;

  beforeEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = TOKEN;
    mocks.enabled.mockResolvedValue(true);
    mocks.sendAlert.mockClear();
  });
  afterEach(() => {
    process.env.ALERTMANAGER_WEBHOOK_TOKEN = originalEnv;
    mocks.sendAlert.mockResolvedValue(true);
  });

  const firing = {
    alerts: [{ status: 'firing', labels: { severity: 'critical', alertname: 'rule-1' }, annotations: { summary: 'Disk full' } }],
  };

  it('answers 503 when a firing alert could not be delivered (Alertmanager must retry)', async () => {
    mocks.sendAlert.mockResolvedValue(false);
    const res = await POST(reqWithBody(firing));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      forwarded: 0,
      error: 'Не удалось доставить алерты в Telegram',
    });
    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
  });

  it('I08: partial batch returns 503; a reordered retry sends only the failed message', async () => {
    const alerts = [
      { status: 'firing', startsAt: '2026-10-02T00:00:00Z', labels: { severity: 'critical', alertname: 'rule-1' }, annotations: {} },
      { status: 'firing', startsAt: '2026-10-02T00:00:00Z', labels: { severity: 'warning', alertname: 'rule-2' }, annotations: {} },
    ];
    mocks.sendAlert.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const res = await POST(reqWithBody({ alerts }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, forwarded: 1 });
    mocks.sendAlert.mockClear().mockResolvedValue(true);
    const retry = await POST(reqWithBody({ alerts: [...alerts].reverse() }));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, forwarded: 2 });
    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendAlert.mock.calls[0][0].ruleId).toBe('rule-1');
  });

  it.each([['critical', 1], ['warning', 4]])('F6 review3: %s reminders deliver again after %sh', async (severity, hours) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
      const alerts = [{ status: 'firing', startsAt: '2026-10-02T00:00:00Z', labels: { severity, alertname: 'disk' }, annotations: {} }];
      expect((await POST(reqWithBody({ alerts }))).status).toBe(200);
      mocks.sendAlert.mockClear();
      expect((await POST(reqWithBody({ alerts }))).status).toBe(200);
      expect(mocks.sendAlert).not.toHaveBeenCalled();
      vi.setSystemTime(new Date(Date.now() + hours * 3600_000));
      expect((await POST(reqWithBody({ alerts }))).status).toBe(200);
      expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
      expect(mocks.rows.size).toBe(2);
    } finally { vi.useRealTimers(); }
  });
  it('F2: a repeat after DLQ gets a new durable attempt and can deliver', async () => {
    const alerts = [{ status: 'firing', startsAt: '2026-10-03T00:00:00Z', labels: { alertname: 'disk' }, annotations: { summary: 'Disk full' } }];
    mocks.sendAlert.mockResolvedValue(false);
    expect((await POST(reqWithBody({ alerts }))).status).toBe(503);
    const dead = [...mocks.rows.values()][0];
    dead.published = true; dead.lastError = 'Moved to DLQ: retries exhausted';
    mocks.sendAlert.mockClear().mockResolvedValue(true);
    expect((await POST(reqWithBody({ alerts }))).status).toBe(200);
    expect(mocks.sendAlert).toHaveBeenCalledTimes(1);
    expect(mocks.rows.size).toBe(2);
    expect(dead.lastError).toBe('Moved to DLQ: retries exhausted');
    expect([...mocks.rows.values()][1]).toMatchObject({ published: true, lastError: null });
  });
  it('answers 200 when the batch has only resolved alerts (no firing to deliver)', async () => {
    const res = await POST(reqWithBody({
      alerts: [{ status: 'resolved', labels: { severity: 'critical', alertname: 'rule-1' }, annotations: {} }],
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, forwarded: 0 });
    expect(mocks.sendAlert).not.toHaveBeenCalled();
  });
});
