/**
 * Site Admin Command Service — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeSitePlans } from '../site-admin-command.service';

// Клиент интерактивной транзакции: удаление узла и подсчёт выработки идут в ней
// и по одному клиенту (F-R39-RACE).
const { txState } = vi.hoisted(() => ({
  txState: {
    tx: {
      $queryRaw: vi.fn(),
      pileWork: { count: vi.fn() },
      leaderDrilling: { count: vi.fn() },
      pileField: { findFirst: vi.fn(), delete: vi.fn() },
      cluster: { findFirst: vi.fn(), delete: vi.fn() },
      picket: { findFirst: vi.fn(), delete: vi.fn() },
    },
  },
}));

// Mock db for functions that require it
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn((fn: (client: unknown) => unknown) => fn(txState.tx)),
    userSiteAssignment: { upsert: vi.fn(), deleteMany: vi.fn() },
    pileField: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    cluster: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    picket: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    pileWork: { count: vi.fn() },
    leaderDrilling: { count: vi.fn() },
    site: { create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    sitePilePlan: { create: vi.fn() },
    siteDrillingPlan: { create: vi.fn() },
    crew: { count: vi.fn() },
    report: { count: vi.fn() },
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
  hardDeleteSite,
} from '../site-admin-command.service';
import { db } from '@/lib/db';

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
    await expect(createSiteWithPlans({ name: '' }, { tenantId: 't1', actorId: 'a1' })).rejects.toThrow('Укажите название.');
  });

  it('should throw when name is whitespace', async () => {
    await expect(createSiteWithPlans({ name: '   ' }, { tenantId: 't1', actorId: 'a1' })).rejects.toThrow('Укажите название.');
  });
});

describe('assignUserToSite', () => {
  it('should throw when siteId is empty', async () => {
    await expect(assignUserToSite('', 'user-1', ctx)).rejects.toThrow('Выберите пользователя и объект.');
  });

  it('should throw when userId is empty', async () => {
    await expect(assignUserToSite('site-1', '', ctx)).rejects.toThrow('Выберите пользователя и объект.');
  });
});

describe('unassignUserFromSite', () => {
  it('should throw when siteId is empty', async () => {
    await expect(unassignUserFromSite('', 'user-1', ctx)).rejects.toThrow('Выберите пользователя и объект.');
  });

  it('should throw when userId is empty', async () => {
    await expect(unassignUserFromSite('site-1', '', ctx)).rejects.toThrow('Выберите пользователя и объект.');
  });
});

describe('createSiteHierarchyItem', () => {
  it('should throw when type is empty', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: '', name: 'Field A' }, ctx)
    ).rejects.toThrow('Недостаточно данных — обновите страницу и повторите.');
  });

  it('should throw when name is empty', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'field', name: '' }, ctx)
    ).rejects.toThrow('Недостаточно данных — обновите страницу и повторите.');
  });

  it('should throw when cluster has no parentId', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'cluster', name: 'Cluster A' }, ctx)
    ).rejects.toThrow('Выберите родительский элемент.');
  });

  it('should throw when picket has no parentId', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'picket', name: 'Picket 1' }, ctx)
    ).rejects.toThrow('Выберите родительский элемент.');
  });

  it('should throw for invalid type', async () => {
    await expect(
      createSiteHierarchyItem({ siteId: 's-1', type: 'unknown', name: 'X' }, ctx)
    ).rejects.toThrow('Неизвестный тип элемента — обновите страницу.');
  });
});

describe('hardDeleteSite — irreversible-delete safety guard', () => {
  it('refuses (409) to delete a site that still has crews or reports, and never calls delete', async () => {
    vi.mocked(db.site.findFirst).mockResolvedValue({ id: 's1', tenantId: 't1' } as never);
    vi.mocked(db.crew.count).mockResolvedValue(2);
    vi.mocked(db.report.count).mockResolvedValue(0);

    await expect(hardDeleteSite('s1', ctx)).rejects.toThrow(/Нельзя удалить/);
    expect(db.site.delete).not.toHaveBeenCalled();
  });
});

describe('deleteSiteHierarchyItem', () => {
  const tx = txState.tx;

  beforeEach(() => {
    vi.mocked(db.site.findFirst).mockResolvedValue({ id: 's1', tenantId: 't1' } as never);
    tx.$queryRaw.mockReset().mockResolvedValue([{ id: 'p-1' }]);
    tx.pileWork.count.mockReset().mockResolvedValue(0);
    tx.leaderDrilling.count.mockReset().mockResolvedValue(0);
    tx.pileField.findFirst.mockReset().mockResolvedValue({ id: 'item-1' } as never);
    tx.cluster.findFirst.mockReset().mockResolvedValue({ id: 'item-1' } as never);
    tx.picket.findFirst.mockReset().mockResolvedValue({ id: 'p-1' } as never);
    tx.picket.delete.mockReset().mockResolvedValue({ id: 'p-1' } as never);
  });

  it('should throw when type is empty', async () => {
    await expect(deleteSiteHierarchyItem('s1', '', 'item-1', ctx)).rejects.toThrow('Недостаточно данных — обновите страницу и повторите.');
  });

  it('should throw when itemId is empty', async () => {
    await expect(deleteSiteHierarchyItem('s1', 'field', '', ctx)).rejects.toThrow('Недостаточно данных — обновите страницу и повторите.');
  });

  it('should throw for invalid type', async () => {
    await expect(deleteSiteHierarchyItem('s1', 'unknown', 'item-1', ctx)).rejects.toThrow('Неизвестный тип элемента — обновите страницу.');
  });

  it('refuses (409) to delete a picket with production rows and never calls delete', async () => {
    tx.pileWork.count.mockResolvedValue(12);

    await expect(deleteSiteHierarchyItem('s1', 'picket', 'p-1', ctx)).rejects.toThrow(
      'Нельзя удалить пикет: на нём 12 записей выработки. Сначала перенесите их.'
    );
    expect(tx.picket.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty picket without production rows', async () => {
    const result = await deleteSiteHierarchyItem('s1', 'picket', 'p-1', ctx);

    expect(tx.pileWork.count).toHaveBeenCalledWith({ where: { picketId: 'p-1' } });
    expect(tx.picket.delete).toHaveBeenCalledWith({ where: { id: 'p-1' } });
    expect(result).toEqual({ success: true });
  });

  it('locks the node row FOR UPDATE as the first statement and keeps the whole check on the tx client', async () => {
    await deleteSiteHierarchyItem('s1', 'picket', 'p-1', ctx);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('SELECT id FROM "Picket" WHERE id = ');
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[0][1]).toBe('p-1');
    // Блокировка — до подсчёта выработки и до удаления.
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.pileWork.count.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.picket.delete.mock.invocationCallOrder[0]);
    // Ни один шаг не ушёл на клиент вне транзакции.
    expect(db.pileWork.count).not.toHaveBeenCalled();
    expect(db.picket.findFirst).not.toHaveBeenCalled();
    expect(db.picket.delete).not.toHaveBeenCalled();
  });

  it('locks the matching table for each hierarchy type', async () => {
    await deleteSiteHierarchyItem('s1', 'field', 'item-1', ctx);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FROM "PileField"');

    tx.$queryRaw.mockClear();
    await deleteSiteHierarchyItem('s1', 'cluster', 'item-1', ctx);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FROM "Cluster"');
  });

  it('locks the whole field subtree top-down (field → clusters → pickets) before counting', async () => {
    await deleteSiteHierarchyItem('s1', 'field', 'item-1', ctx);

    const locks = tx.$queryRaw.mock.calls.map((call) => call[0].join(''));
    expect(locks).toHaveLength(3);
    expect(locks[0]).toContain('FROM "PileField" WHERE id = ');
    expect(locks[0]).toContain('FOR UPDATE');
    expect(locks[1]).toContain('FROM "Cluster" WHERE "fieldId" = ');
    expect(locks[1]).toContain('ORDER BY id FOR UPDATE');
    expect(locks[2]).toContain('FROM "Picket" WHERE "clusterId" IN ');
    expect(locks[2]).toContain('ORDER BY id FOR UPDATE');
    // Все три блокировки — до подсчёта выработки и до удаления.
    const lastLock = tx.$queryRaw.mock.invocationCallOrder[2];
    expect(lastLock).toBeLessThan(tx.pileWork.count.mock.invocationCallOrder[0]);
    expect(lastLock).toBeLessThan(tx.pileField.delete.mock.invocationCallOrder[0]);
  });

  it('locks a cluster and then its pickets before counting', async () => {
    await deleteSiteHierarchyItem('s1', 'cluster', 'item-1', ctx);

    const locks = tx.$queryRaw.mock.calls.map((call) => call[0].join(''));
    expect(locks).toHaveLength(2);
    expect(locks[0]).toContain('FROM "Cluster" WHERE id = ');
    expect(locks[0]).toContain('FOR UPDATE');
    expect(locks[1]).toContain('FROM "Picket" WHERE "clusterId" = ');
    expect(locks[1]).toContain('ORDER BY id FOR UPDATE');
    const lastLock = tx.$queryRaw.mock.invocationCallOrder[1];
    expect(lastLock).toBeLessThan(tx.pileWork.count.mock.invocationCallOrder[0]);
    expect(lastLock).toBeLessThan(tx.cluster.delete.mock.invocationCallOrder[0]);
  });
});
