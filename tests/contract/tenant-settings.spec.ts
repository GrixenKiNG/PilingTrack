import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { tenantSettings: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

import { db } from '@/lib/db';
import { getSettings, saveSettings } from '@/modules/settings';
import { sanitizeSettings, DEFAULT_WORKSPACE_SETTINGS } from '@/modules/settings/domain/settings';

const anyDb = db.tenantSettings as unknown as { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };

describe('settings sanitizer', () => {
  it('keeps only known notification keys as booleans', () => {
    const s = sanitizeSettings({ notifications: { downtime30: false, bogus: true } });
    expect(s.notifications.downtime30).toBe(false);
    expect('bogus' in s.notifications).toBe(false);
    expect(Object.keys(s.notifications).sort()).toEqual(['downtime30', 'maintenanceOverdue', 'newReports', 'planDeviation']);
  });

  it('rejects an unknown units value and over-long strings', () => {
    const s = sanitizeSettings({ units: 'lightyears', companyName: 'x'.repeat(500) });
    expect(s.units).toBe(DEFAULT_WORKSPACE_SETTINGS.units);
    expect(s.companyName).toBe(DEFAULT_WORKSPACE_SETTINGS.companyName);
  });
});

describe('settings service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns defaults when no row exists', async () => {
    anyDb.findUnique.mockResolvedValue(null);
    const s = await getSettings('orion');
    expect(s.currency).toBe('RUB');
    expect(s.notifications.downtime30).toBe(true);
  });

  it('fails closed on missing tenantId', async () => {
    await expect(getSettings('')).rejects.toThrow('tenantId is required');
    await expect(saveSettings('', {}, 'u1')).rejects.toThrow('tenantId is required');
  });

  it('upserts sanitized settings for the tenant', async () => {
    anyDb.findUnique.mockResolvedValue(null);
    anyDb.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => args.create);
    await saveSettings('orion', { companyName: 'ООО «Орион»', units: 'metric' }, 'admin-1');
    const call = anyDb.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId: 'orion' });
    expect(call.create.companyName).toBe('ООО «Орион»');
    expect(call.create.updatedBy).toBe('admin-1');
  });
});
