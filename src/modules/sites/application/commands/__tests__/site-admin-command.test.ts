/**
 * Site Admin Command Service — Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { normalizeSitePlans } from '../site-admin-command.service';

// Mock db for functions that require it
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    userSiteAssignment: { upsert: vi.fn(), deleteMany: vi.fn() },
    pileField: { create: vi.fn(), delete: vi.fn() },
    cluster: { create: vi.fn(), delete: vi.fn() },
    picket: { create: vi.fn(), delete: vi.fn() },
    site: { create: vi.fn() },
    sitePilePlan: { create: vi.fn() },
    siteDrillingPlan: { create: vi.fn() },
  },
}));

vi.mock('@/lib/service-error', () => ({
  ServiceError: class ServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ServiceError';
    }
  },
}));

import {
  createSiteWithPlans,
  assignUserToSite,
  unassignUserFromSite,
  createSiteHierarchyItem,
  deleteSiteHierarchyItem,
} from '../site-admin-command.service';

const ctx = { tenantId: 't1', actorId: 'a1' };

describe('normalizeSitePlans', () => {
  it('should return empty arrays when no plans provided', () => {
    const result = normalizeSitePlans({});
    expect(result.pilePlans).toEqual([]);
    expect(result.drillingPlans).toEqual([]);
    expect(result.plannedPiles).toBe(0);
    expect(result.plannedDrilling).toBe(0);
  });

  it('should filter out invalid pile plans (missing pileGradeId)', () => {
    const result = normalizeSitePlans({
      pilePlans: [
        { count: 10 },                                // no pileGradeId
        { pileGradeId: 'pg-1', count: 5 },           // valid
        { pileGradeId: '', count: 3 },                // empty pileGradeId
      ],
    });
    expect(result.pilePlans).toHaveLength(1);
    expect(result.pilePlans[0].pileGradeId).toBe('pg-1');
    expect(result.plannedPiles).toBe(5);
  });

  it('should filter out plans with zero or negative count', () => {
    const result = normalizeSitePlans({
      pilePlans: [
        { pileGradeId: 'pg-1', count: 0 },
        { pileGradeId: 'pg-2', count: -1 },
        { pileGradeId: 'pg-3', count: 10 },
      ],
    });
    expect(result.pilePlans).toHaveLength(1);
    expect(result.plannedPiles).toBe(10);
  });

  it('should filter out plans with non-numeric count', () => {
    const result = normalizeSitePlans({
      pilePlans: [
        { pileGradeId: 'pg-1' },              // count undefined
        { pileGradeId: 'pg-2', count: 7 },    // valid
      ],
    });
    expect(result.pilePlans).toHaveLength(1);
  });

  it('should calculate plannedPiles as sum of valid pile counts', () => {
    const result = normalizeSitePlans({
      pilePlans: [
        { pileGradeId: 'pg-1', count: 100 },
        { pileGradeId: 'pg-2', count: 200 },
      ],
    });
    expect(result.plannedPiles).toBe(300);
  });

  it('should calculate plannedDrilling as sum of count * metersPerUnit', () => {
    const result = normalizeSitePlans({
      drillingPlans: [
        { count: 10, metersPerUnit: 5 },   // 50
        { count: 20, metersPerUnit: 3 },   // 60
      ],
    });
    expect(result.plannedDrilling).toBe(110);
  });

  it('should treat missing metersPerUnit as 0 in drilling calculation', () => {
    const result = normalizeSitePlans({
      drillingPlans: [
        { count: 10 },   // 10 * 0 = 0
      ],
    });
    expect(result.plannedDrilling).toBe(0);
    expect(result.drillingPlans).toHaveLength(1);
  });

  it('should handle both pile and drilling plans together', () => {
    const result = normalizeSitePlans({
      pilePlans: [{ pileGradeId: 'pg-1', count: 50 }],
      drillingPlans: [{ count: 10, metersPerUnit: 8, diameter: 300 }],
    });
    expect(result.plannedPiles).toBe(50);
    expect(result.plannedDrilling).toBe(80);
    expect(result.drillingPlans[0].diameter).toBe(300);
  });

  it('should handle non-array input gracefully', () => {
    const result = normalizeSitePlans({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
      pilePlans: 'not-an-array' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
      drillingPlans: null as any,
    });
    expect(result.pilePlans).toEqual([]);
    expect(result.drillingPlans).toEqual([]);
  });
});

describe('createSiteWithPlans', () => {
  it('should throw when name is empty', async () => {
    await expect(createSiteWithPlans({ name: '' }, { tenantId: 't1', actorId: 'a1' })).rejects.toThrow('Name required');
  });

  it('should throw when name is whitespace', async () => {
    await expect(createSiteWithPlans({ name: '   ' }, { tenantId: 't1', actorId: 'a1' })).rejects.toThrow('Name required');
  });
});

describe('assignUserToSite', () => {
  it('should throw when siteId is empty', async () => {
    await expect(assignUserToSite('', 'user-1', ctx)).rejects.toThrow('userId and siteId required');
  });

  it('should throw when userId is empty', async () => {
    await expect(assignUserToSite('site-1', '', ctx)).rejects.toThrow('userId and siteId required');
  });
});

describe('unassignUserFromSite', () => {
  it('should throw when siteId is empty', async () => {
    await expect(unassignUserFromSite('', 'user-1', ctx)).rejects.toThrow('userId and siteId required');
  });

  it('should throw when userId is empty', async () => {
    await expect(unassignUserFromSite('site-1', '', ctx)).rejects.toThrow('userId and siteId required');
  });
});

describe('createSiteHierarchyItem', () => {
  it('should throw when type is empty', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: '', name: 'Field A' }, ctx)
    ).rejects.toThrow('Type and name required');
  });

  it('should throw when name is empty', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'field', name: '' }, ctx)
    ).rejects.toThrow('Type and name required');
  });

  it('should throw when cluster has no parentId', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'cluster', name: 'Cluster A' }, ctx)
    ).rejects.toThrow('parentId required');
  });

  it('should throw when picket has no parentId', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'picket', name: 'Picket 1' }, ctx)
    ).rejects.toThrow('parentId required');
  });

  it('should throw for invalid type', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'unknown', name: 'X' }, ctx)
    ).rejects.toThrow('Invalid type');
  });
});

describe('deleteSiteHierarchyItem', () => {
  it('should throw when type is empty', async () => {
    await expect(deleteSiteHierarchyItem('s1', '', 'item-1', ctx)).rejects.toThrow('Type and itemId required');
  });

  it('should throw when itemId is empty', async () => {
    await expect(deleteSiteHierarchyItem('s1', 'field', '', ctx)).rejects.toThrow('Type and itemId required');
  });

  it('should throw for invalid type', async () => {
    await expect(deleteSiteHierarchyItem('s1', 'unknown', 'item-1', ctx)).rejects.toThrow('Invalid type');
  });
});
