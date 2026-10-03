/**
 * Site Repository — outbox tenantId (audit finding F-R86-OUTBOX-TENANT)
 *
 * Строка outbox без организации бесполезна: потребитель открывает контекст
 * ровно значением колонки tenantId (outbox-publisher.ts), и при пустом
 * tenantId строгая политика RLS молча отдаёт обработчику ноль строк. События
 * SiteActivated/SiteDeactivated организации в себе не несут, поэтому
 * репозиторий берёт её из состояния агрегата, а не из события.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SiteAggregate } from '../../domain';

const { tx, transactionMock } = vi.hoisted(() => {
  const tx = {
    site: { upsert: vi.fn().mockResolvedValue({}) },
    outboxEvent: { createMany: vi.fn().mockResolvedValue({}) },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test transaction shim
  return { tx, transactionMock: vi.fn((cb: any) => cb(tx)) };
});

vi.mock('@/lib/db', () => ({
  db: { $transaction: transactionMock },
}));

import { PrismaSiteRepository } from '../site.repository';

function makeAggregate(): SiteAggregate {
  // .create() seeds exactly one pending event (SiteCreated).
  return SiteAggregate.create({ name: 'Объект-1', tenantId: 'tenant-s' });
}

describe('PrismaSiteRepository.save — outbox tenantId', () => {
  const repo = new PrismaSiteRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    tx.site.upsert.mockResolvedValue({});
    tx.outboxEvent.createMany.mockResolvedValue({});
  });

  it('writes the aggregate tenantId into the outbox rows (F-R86-OUTBOX-TENANT)', async () => {
    await repo.save(makeAggregate());

    expect(tx.outboxEvent.createMany).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tenantId: 'tenant-s' })],
    });
  });
});
