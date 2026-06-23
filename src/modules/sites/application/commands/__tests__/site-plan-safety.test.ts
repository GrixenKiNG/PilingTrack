import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const tx = {
    site: { update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    sitePilePlan: { deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
    siteDrillingPlan: { deleteMany: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  };
  return {
    tx,
    transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    siteFindFirst: vi.fn(),
    gradeCount: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: {
  $transaction: m.transaction,
  site: { findFirst: m.siteFindFirst },
  pileGrade: { count: m.gradeCount },
} }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: vi.fn() }));

import { createSiteWithPlans, updateSiteWithPlans } from '../site-admin-command.service';

describe('updateSiteWithPlans safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.siteFindFirst.mockResolvedValue({ id: 's1', tenantId: 't1', name: 'Site', plannedPiles: 10, plannedDrilling: 20 });
    m.tx.site.findUnique.mockResolvedValue({ id: 's1', name: 'Site', plannedPiles: 10, plannedDrilling: 15 });
  });

  it('preserves omitted pile plans while replacing supplied drilling plans', async () => {
    await updateSiteWithPlans('s1', { drillingPlans: [{ diameter: 300, count: 3, metersPerUnit: 5 }] }, { tenantId: 't1', actorId: 'a1' });
    expect(m.tx.sitePilePlan.deleteMany).not.toHaveBeenCalled();
    expect(m.tx.siteDrillingPlan.deleteMany).toHaveBeenCalledWith({ where: { siteId: 's1' } });
    expect(m.tx.site.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plannedPiles: undefined, plannedDrilling: 15 }),
    }));
  });

  it('clears an explicitly empty pile plan without touching drilling plans', async () => {
    await updateSiteWithPlans('s1', { pilePlans: [] }, { tenantId: 't1', actorId: 'a1' });
    expect(m.tx.sitePilePlan.deleteMany).toHaveBeenCalledWith({ where: { siteId: 's1' } });
    expect(m.tx.siteDrillingPlan.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a site outside the tenant', async () => {
    m.siteFindFirst.mockResolvedValue(null);
    await expect(updateSiteWithPlans('s1', { pilePlans: [] }, { tenantId: 'other', actorId: 'a1' }))
      .rejects.toThrow('Site not found');
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('batches supplied plan inserts with createMany instead of per-row create', async () => {
    m.gradeCount.mockResolvedValue(2);
    await updateSiteWithPlans('s1', {
      pilePlans: [{ pileGradeId: 'pg1', count: 5, metersPerUnit: 2 }, { pileGradeId: 'pg2', count: 3 }],
      drillingPlans: [{ diameter: 300, count: 4, metersPerUnit: 5 }],
    }, { tenantId: 't1', actorId: 'a1' });

    expect(m.tx.sitePilePlan.create).not.toHaveBeenCalled();
    expect(m.tx.siteDrillingPlan.create).not.toHaveBeenCalled();
    expect(m.tx.sitePilePlan.createMany).toHaveBeenCalledWith({
      data: [
        { siteId: 's1', pileGradeId: 'pg1', count: 5, metersPerUnit: 2 },
        { siteId: 's1', pileGradeId: 'pg2', count: 3, metersPerUnit: 0 },
      ],
    });
    expect(m.tx.siteDrillingPlan.createMany).toHaveBeenCalledWith({
      data: [{ siteId: 's1', diameter: 300, count: 4, metersPerUnit: 5 }],
    });
  });
});

describe('createSiteWithPlans batching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.gradeCount.mockResolvedValue(1);
    m.tx.site.create.mockResolvedValue({ id: 'new', name: 'X', plannedPiles: 5, plannedDrilling: 0 });
  });

  it('inserts plans with createMany, not a per-row create loop', async () => {
    await createSiteWithPlans(
      { name: 'X', pilePlans: [{ pileGradeId: 'pg1', count: 5, metersPerUnit: 2 }] },
      { tenantId: 't1', actorId: 'a1' },
    );
    expect(m.tx.sitePilePlan.create).not.toHaveBeenCalled();
    expect(m.tx.sitePilePlan.createMany).toHaveBeenCalledWith({
      data: [{ siteId: 'new', pileGradeId: 'pg1', count: 5, metersPerUnit: 2 }],
    });
    expect(m.tx.siteDrillingPlan.createMany).not.toHaveBeenCalled();
  });
});
