/**
 * PUT /api/settings — behavioural tests.
 *
 * Pins: ADMIN-only boundary, tenant fail-closed, and the audit trail that a
 * settings change must leave behind (audit finding F-R34-17). Saving the same
 * values back must NOT write a feed entry — the feed shows changes, not every
 * open of the settings screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getSettingsMock, saveSettingsMock, recordAuditEventMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getSettingsMock: vi.fn(),
  saveSettingsMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/settings', () => ({
  getSettings: getSettingsMock,
  saveSettings: saveSettingsMock,
}));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));

import { PUT } from '../route';

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };

function currentSettings() {
  return {
    companyName: 'Ромашка',
    inn: '7701234567',
    timezone: 'Europe/Moscow',
    dateFormat: 'DD.MM.YYYY',
    units: 'metric',
    currency: 'RUB',
    notifications: { downtime30: true, newReports: false },
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: admin, error: null });
    getSettingsMock.mockResolvedValue(currentSettings());
    saveSettingsMock.mockImplementation(async (_tenantId: string, _patch: unknown, _actorId: string) => currentSettings());
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('returns 403 for a non-admin and writes no trail', async () => {
    requireAuthMock.mockResolvedValue({ user: { ...admin, role: 'DISPATCHER' }, error: null });

    const response = await PUT(req({ timezone: 'Asia/Krasnoyarsk' }));

    expect(response.status).toBe(403);
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('fails closed when the admin has no tenant', async () => {
    requireAuthMock.mockResolvedValue({ user: { ...admin, tenantId: null }, error: null });

    const response = await PUT(req({ timezone: 'Asia/Krasnoyarsk' }));

    expect(response.status).toBe(403);
    expect(getSettingsMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...admin, role: 'OPERATOR' },
    { ...admin, actingAs: 'OPERATOR' },
  ])('denies settings mutation for an effective operator: %j', async (user) => {
    requireAuthMock.mockResolvedValue({ user, error: null });
    const response = await PUT(req({ timezone: 'Asia/Krasnoyarsk' }));
    expect(response.status).toBe(403);
    expect(getSettingsMock).not.toHaveBeenCalled();
    expect(saveSettingsMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('reads the previous settings before saving', async () => {
    await PUT(req({ companyName: 'Ромашка' }));

    expect(getSettingsMock).toHaveBeenCalledWith('tenant-a');
    expect(saveSettingsMock).toHaveBeenCalledWith('tenant-a', expect.anything(), 'admin-a');
  });

  it('records settings.updated with before/after when the timezone changed', async () => {
    const after = { ...currentSettings(), timezone: 'Asia/Krasnoyarsk' };
    saveSettingsMock.mockResolvedValue(after);

    const response = await PUT(req({ timezone: 'Asia/Krasnoyarsk' }));

    expect(response.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'settings.updated',
      scope: 'settings',
      actorId: 'admin-a',
      tenantId: 'tenant-a',
      metadata: { before: currentSettings(), after },
    });
  });

  it('records a notification toggle change', async () => {
    const after = {
      ...currentSettings(),
      notifications: { downtime30: false, newReports: false },
    };
    saveSettingsMock.mockResolvedValue(after);

    await PUT(req({ notifications: { downtime30: false } }));

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.updated',
        metadata: { before: currentSettings(), after },
      }),
    );
  });

  it('does not record when nothing actually changed', async () => {
    const response = await PUT(req({}));

    expect(response.status).toBe(200);
    expect(saveSettingsMock).toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
