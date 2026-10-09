import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), test: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: m.auth }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({ db: { telegramConfig: { findFirst: m.find } } }));
vi.mock('@/core/notifications/telegram', () => ({ telegramNotifier: { testConnection: m.test } }));
import { POST } from '../route';
const admin = { id: 'admin', role: 'ADMIN', tenantId: 'tenant-b' };
const request = (body: unknown) => new NextRequest('http://localhost/api/notifications/telegram/test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: admin, error: null });
  m.find.mockResolvedValue({ id: 'second' });
  m.test.mockResolvedValue({ ok: true, chatTitle: 'Второй' });
});
describe('F4: selected Telegram config is tenant scoped', () => {
  it('tests the selected second config with the session tenant', async () => {
    const response = await POST(request({ configId: 'second' }));
    expect(response.status).toBe(200);
    expect(m.find).toHaveBeenCalledWith({ where: { id: 'second', tenantId: 'tenant-b' }, select: { id: true } });
    expect(m.test).toHaveBeenCalledWith('second', 'tenant-b');
    expect(await response.json()).toEqual({ ok: true, chatTitle: 'Второй' });
  });
  it('never tests a foreign or missing config', async () => {
    m.find.mockResolvedValue(null);
    expect((await POST(request({ configId: 'foreign' }))).status).toBe(404);
    expect(m.test).not.toHaveBeenCalled();
  });
  it.each([{}, { configId: '' }, { configId: 3 }, null])('rejects malformed body %j', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(m.test).not.toHaveBeenCalled();
  });
  it('fails closed without a session tenant', async () => {
    m.auth.mockResolvedValue({ user: { ...admin, tenantId: null }, error: null });
    expect((await POST(request({ configId: 'second' }))).status).toBe(403);
    expect(m.find).not.toHaveBeenCalled(); expect(m.test).not.toHaveBeenCalled();
  });
  it('retains the role guard', async () => {
    m.auth.mockResolvedValue({ user: { ...admin, role: 'OPERATOR' }, error: null });
    expect((await POST(request({ configId: 'second' }))).status).toBe(403);
    expect(m.test).not.toHaveBeenCalled();
  });
  it.each(['DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER'])('denies a report reader without telegram.manage: %s', async role => {
    m.auth.mockResolvedValue({ user: { ...admin, role }, error: null });
    expect((await POST(request({ configId: 'second' }))).status).toBe(403);
    expect(m.find).not.toHaveBeenCalled();
    expect(m.test).not.toHaveBeenCalled();
  });
  it('denies ADMIN acting as FOREMAN', async () => {
    m.auth.mockResolvedValue({ user: { ...admin, actingAs: 'FOREMAN' }, error: null });
    expect((await POST(request({ configId: 'second' }))).status).toBe(403);
    expect(m.find).not.toHaveBeenCalled();
    expect(m.test).not.toHaveBeenCalled();
  });
  it('retains the authentication guard', async () => {
    m.auth.mockResolvedValue({ user: null, error: NextResponse.json({ error: 'auth' }, { status: 401 }) });
    expect((await POST(request({ configId: 'second' }))).status).toBe(401);
    expect(m.test).not.toHaveBeenCalled();
  });
});
