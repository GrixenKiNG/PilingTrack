/**
 * Crew Repository — outbox tenantId (audit finding F-R86-OUTBOX-TENANT)
 *
 * У бригады нет своей колонки tenantId: её организация — организация объекта
 * (site). Строка outbox без организации бесполезна, потому что потребитель
 * открывает контекст ровно значением колонки tenantId (outbox-publisher.ts) и
 * при null строгая политика RLS молча отдаёт обработчику ноль строк. Источник — Site внутри той же транзакции; контекст платформенного ADMIN
 * может относиться к другой организации.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { CrewAggregate } from '../../domain';

const { tx, transactionMock } = vi.hoisted(() => {
  const tx = {
    site: { findUnique: vi.fn() },
    crew: { upsert: vi.fn().mockResolvedValue({}) },
    outboxEvent: { createMany: vi.fn().mockResolvedValue({}) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test transaction shim
  return { tx, transactionMock: vi.fn((cb: any) => cb(tx)) };
});

vi.mock('@/lib/db', () => ({
  DEFAULT_TX_OPTIONS: {},
  db: { $transaction: transactionMock },
}));

import { PrismaCrewRepository } from '../crew.repository';

function makeAggregate(): CrewAggregate {
  // .create() seeds exactly one pending event (CrewCreated).
  return CrewAggregate.create(
    { name: 'Бригада-1', operatorId: 'op-1', equipmentId: 'eq-1', siteId: 'site-1' },
    'user-1'
  );
}

describe('PrismaCrewRepository.save — outbox tenantId', () => {
  const repo = new PrismaCrewRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    tx.site.findUnique.mockResolvedValue({ tenantId: "tenant-site" });
    tx.crew.upsert.mockResolvedValue({});
    tx.outboxEvent.createMany.mockResolvedValue({});
  });

  it('writes the Site tenant, even when the platform ADMIN context belongs to another tenant (F-R86-OUTBOX-TENANT)', async () => {
    await runWithTenantContext(async () => {
      setRequestTenantId('tenant-c');
      await repo.save(makeAggregate());
    });

    expect(tx.site.findUnique).toHaveBeenCalledWith({ where: { id: 'site-1' }, select: { tenantId: true } });
    expect(tx.outboxEvent.createMany).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tenantId: 'tenant-site' })],
    });
  });
  it('uses Site without a request tenant', async () => {
    await repo.save(makeAggregate());
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ tenantId: 'tenant-site' })] });
  });
  it.each([null, { tenantId: null }])('refuses unresolvable Site identity %j and retains events for retry', async (site) => {
    tx.site.findUnique.mockResolvedValue(site);
    const aggregate = makeAggregate();
    await expect(repo.save(aggregate)).rejects.toThrow('Site.tenantId');
    expect(tx.outboxEvent.createMany).not.toHaveBeenCalled();
    expect(aggregate.getPendingEvents()).toHaveLength(1);
  });
});
