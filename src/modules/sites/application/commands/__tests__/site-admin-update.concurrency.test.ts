/**
 * updateSiteWithPlans / setSiteCompleted не затирают конкурентную правку объекта:
 * запись условна по updatedAt, прочитанному в начале команды.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { txState } = vi.hoisted(() => ({
  txState: {
    tx: {
      site: { updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
      sitePilePlan: { deleteMany: vi.fn(), createMany: vi.fn() },
      siteDrillingPlan: { deleteMany: vi.fn(), createMany: vi.fn() },
    },
  },
}));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn((fn: (client: unknown) => unknown) => fn(txState.tx)),
    site: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    pileGrade: { count: vi.fn() },
  },
}));

vi.mock('@/modules/audit', () => ({ recordAuditEventInTx: vi.fn(async () => undefined) }));

import { updateSiteWithPlans, setSiteCompleted } from '../site-admin-command.service';
import { db } from '@/lib/db';

const ctx = { tenantId: 't1', actorId: 'a1' };
const readAt = new Date('2026-10-21T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.site.findFirst).mockResolvedValue({ id: 's1', name: 'Объект', updatedAt: readAt } as never);
  txState.tx.site.updateMany.mockResolvedValue({ count: 1 });
  txState.tx.site.findUnique.mockResolvedValue({ id: 's1' });
  vi.mocked(db.site.updateMany).mockResolvedValue({ count: 1 } as never);
});

describe('updateSiteWithPlans — конкурентная правка', () => {
  it('пишет объект условно по updatedAt и организации', async () => {
    await updateSiteWithPlans('s1', { name: 'Новое' }, ctx);

    expect(txState.tx.site.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', tenantId: 't1', updatedAt: readAt } }),
    );
  });

  it('при изменении объекта между чтением и записью — 409, планы не стираются', async () => {
    txState.tx.site.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateSiteWithPlans('s1', { name: 'Новое', pilePlans: [] }, ctx))
      .rejects.toMatchObject({ status: 409 });
    expect(txState.tx.sitePilePlan.deleteMany).not.toHaveBeenCalled();
  });
});

describe('setSiteCompleted — конкурентная правка', () => {
  it('при изменении объекта между чтением и записью — 409', async () => {
    txState.tx.site.updateMany.mockResolvedValue({ count: 0 });

    await expect(setSiteCompleted('s1', true, ctx)).rejects.toMatchObject({ status: 409 });
  });

  it('пишет отметку условно по updatedAt и организации', async () => {
    await setSiteCompleted('s1', true, ctx);

    expect(txState.tx.site.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', tenantId: 't1', updatedAt: readAt } }),
    );
  });
});
