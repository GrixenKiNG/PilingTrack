/**
 * Site Command Service — lifecycle audit tests
 *
 * Guards finding #1: activate/deactivate must be no-ops (no audit, no write)
 * when the site is already in the requested state. The edit form always sends
 * `isActive`, so without this guard every save spams the audit/history log.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SiteAggregate, type SiteInfo } from '../../../domain';

const recordAuditEvent = vi.fn();
vi.mock('@/services/audit/audit-service', () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}));

const reportCount = vi.fn();
vi.mock('@/lib/db', () => ({
  db: { report: { count: (...args: unknown[]) => reportCount(...args) }, site: { findUnique: vi.fn() } },
}));

const save = vi.fn();
let stored: SiteAggregate | null = null;
vi.mock('../../../infrastructure', () => ({
  getSiteRepository: () => ({ findById: async () => stored, save: (...args: unknown[]) => save(...args) }),
}));

import { activateSite, deactivateSite } from '../site-command.service';

const ctx = { tenantId: 't1', actorId: 'a1' };

function aggregate(isActive: boolean): SiteAggregate {
  const state: SiteInfo = {
    id: 's1', name: 'Site A', tenantId: 't1',
    status: isActive ? 'ACTIVE' : 'INACTIVE',
    plannedPiles: 0, plannedDrilling: 0, completionDate: null,
    isActive, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return SiteAggregate.reconstitute(state);
}

beforeEach(() => {
  recordAuditEvent.mockReset();
  reportCount.mockReset();
  save.mockReset();
  stored = null;
});

describe('activateSite', () => {
  it('does not record audit or save when site is already active', async () => {
    stored = aggregate(true);
    await activateSite('s1', ctx);
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('records audit once when activating an inactive site', async () => {
    stored = aggregate(false);
    await activateSite('s1', ctx);
    expect(save).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent.mock.calls[0][0]).toMatchObject({ action: 'site.activated' });
  });
});

describe('deactivateSite', () => {
  it('does not record audit, save, or query drafts when site is already inactive', async () => {
    stored = aggregate(false);
    await deactivateSite('s1', ctx);
    expect(recordAuditEvent).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(reportCount).not.toHaveBeenCalled();
  });

  it('records audit once when deactivating an active site with no draft reports', async () => {
    stored = aggregate(true);
    reportCount.mockResolvedValue(0);
    await deactivateSite('s1', ctx);
    expect(save).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent.mock.calls[0][0]).toMatchObject({ action: 'site.deactivated' });
  });

  it('throws 409 and records nothing when draft reports exist', async () => {
    stored = aggregate(true);
    reportCount.mockResolvedValue(2);
    await expect(deactivateSite('s1', ctx)).rejects.toThrow(/незавершённых/);
    expect(save).not.toHaveBeenCalled();
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});
