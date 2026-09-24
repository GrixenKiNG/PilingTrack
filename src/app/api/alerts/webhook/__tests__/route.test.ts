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

vi.mock('@/core/notifications/telegram', () => ({
  telegramNotifier: { sendAlert: vi.fn().mockResolvedValue(true) },
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '../route';

const TOKEN = 'super-secret-webhook-token';

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

  it('rejects a null body with 400 Invalid payload', async () => {
    const res = await POST(reqWithBody(null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid payload' });
  });

  it('rejects an alert missing labels/annotations with 400', async () => {
    const res = await POST(reqWithBody({ alerts: [{ status: 'firing' }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid payload' });
  });

  it('rejects a non-string labels.severity with 400', async () => {
    const res = await POST(reqWithBody({
      alerts: [{ status: 'firing', labels: { severity: 5 }, annotations: {} }],
    }));
    expect(res.status).toBe(400);
  });

  it('accepts a batch over 100 alerts but forwards only the first 100', async () => {
    const alerts = Array.from({ length: 101 }, () => ({
      status: 'firing',
      labels: {},
      annotations: {},
    }));
    const res = await POST(reqWithBody({ alerts }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, forwarded: 100 });
  });

  it('accepts a valid firing alert and forwards it', async () => {
    const res = await POST(reqWithBody({
      alerts: [{ status: 'firing', labels: { severity: 'high', alertname: 'rule-1' }, annotations: { summary: 'High CPU' } }],
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, forwarded: 1 });
  });
});
