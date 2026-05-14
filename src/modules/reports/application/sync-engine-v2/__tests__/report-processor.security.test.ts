/**
 * Security tests for the per-row ownership enforcement that replaced the
 * coarse `reports.manage_all` route gate.
 *
 * Threat model:
 *   - operator opens /api/sync/v2 with their own session and pushes a
 *     change targeting another user's reportId
 *   - operator pushes a CREATE with `userId` set to a different user
 *     (impersonation attempt)
 *
 * Both must be blocked even though the session is valid.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processReportChange, SyncForbiddenError } from '../report-processor';
import type { LocalChange } from '@/core/shared/types/sync';

vi.mock('@/lib/db', () => ({
  db: {
    report: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    reportVersion: { create: vi.fn() },
    idempotencyKey: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    conflictAudit: { create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

import { db } from '@/lib/db';

const operator = { userId: 'operator-1', isPrivileged: false };
const dispatcher = { userId: 'dispatcher-1', isPrivileged: true };

function buildChange(overrides: Partial<LocalChange> & { id: string; userId?: string }): LocalChange {
  const { id, userId, ...rest } = overrides;
  return {
    entity: 'report',
    op: 'upsert',
    opId: `op-${Math.random()}`,
    baseVersion: 1,
    data: { id, reportId: id, userId, siteId: 'site-1', date: '2026-05-14' },
    ...rest,
  } as unknown as LocalChange;
}

describe('processReportChange — ownership enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.idempotencyKey.findUnique as any).mockResolvedValue(null);
  });

  it('rejects operator updating a report owned by someone else', async () => {
    (db.report.findUnique as any).mockResolvedValue({
      id: 'rep-1', version: 1, status: 'draft', vectorClock: {}, userId: 'someone-else',
    });

    const change = buildChange({ id: 'rep-1', userId: 'operator-1' });

    await expect(processReportChange(change, 'orion', operator)).rejects.toBeInstanceOf(SyncForbiddenError);
    expect(db.report.update).not.toHaveBeenCalled();
  });

  it('rejects operator deleting a report owned by someone else', async () => {
    (db.report.findUnique as any).mockResolvedValue({
      id: 'rep-1', version: 1, status: 'draft', vectorClock: {}, userId: 'someone-else',
    });

    const change = buildChange({ id: 'rep-1', op: 'delete' as any });

    await expect(processReportChange(change, 'orion', operator)).rejects.toBeInstanceOf(SyncForbiddenError);
    expect(db.report.delete).not.toHaveBeenCalled();
  });

  it('forces ownership to the actor on CREATE — operator cannot impersonate another user', async () => {
    (db.report.findUnique as any).mockResolvedValue(null);

    // Client tries to plant userId=victim
    const change = buildChange({ id: 'rep-new', userId: 'victim' });

    const result = await processReportChange(change, 'orion', operator);
    expect(result.applied).toBe(true);

    const createCall = (db.report.create as any).mock.calls[0][0];
    expect(createCall.data.userId).toBe('operator-1'); // overridden, not 'victim'
  });

  it('lets dispatcher (privileged) backfill on behalf of any user on CREATE', async () => {
    (db.report.findUnique as any).mockResolvedValue(null);

    const change = buildChange({ id: 'rep-new', userId: 'crew-member-7' });

    await processReportChange(change, 'orion', dispatcher);

    const createCall = (db.report.create as any).mock.calls[0][0];
    expect(createCall.data.userId).toBe('crew-member-7'); // honored for privileged
  });

  it('lets operator update their own report', async () => {
    (db.report.findUnique as any).mockResolvedValue({
      id: 'rep-1', version: 1, status: 'draft', vectorClock: {}, userId: 'operator-1',
    });

    const change = buildChange({ id: 'rep-1', baseVersion: 1 });

    const result = await processReportChange(change, 'orion', operator);
    expect(result.applied).toBe(true);
  });

  it('lets dispatcher update any report inside the tenant', async () => {
    (db.report.findUnique as any).mockResolvedValue({
      id: 'rep-1', version: 1, status: 'draft', vectorClock: {}, userId: 'someone-else',
    });

    const change = buildChange({ id: 'rep-1', baseVersion: 1 });

    const result = await processReportChange(change, 'orion', dispatcher);
    expect(result.applied).toBe(true);
  });
});
