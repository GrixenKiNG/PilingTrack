import { describe, expect, it, vi } from 'vitest';
import { initializeTenantDictionaries } from '../tenant-dictionary-initializer';
import {
  DOWNTIME_REASON_TEMPLATES,
  DRILLING_TYPE_TEMPLATES,
  PILE_GRADE_TEMPLATES,
} from '../system-templates';

describe('initializeTenantDictionaries', () => {
  it('copies every immutable template for the tenant idempotently', async () => {
    const tx = {
      pileGrade: { createMany: vi.fn().mockResolvedValue({ count: PILE_GRADE_TEMPLATES.length }) },
      drillingType: { createMany: vi.fn().mockResolvedValue({ count: DRILLING_TYPE_TEMPLATES.length }) },
      downtimeReason: { createMany: vi.fn().mockResolvedValue({ count: DOWNTIME_REASON_TEMPLATES.length }) },
    };

    await initializeTenantDictionaries(tx as never, 'tenant-a');

    for (const createMany of [
      tx.pileGrade.createMany,
      tx.drillingType.createMany,
      tx.downtimeReason.createMany,
    ]) {
      expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
      expect(createMany.mock.calls[0]?.[0].data.every(
        (item: { tenantId: string; normalizedName: string }) =>
          item.tenantId === 'tenant-a' && item.normalizedName.length > 0
      )).toBe(true);
    }

    expect(tx.pileGrade.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ code: expect.any(String), lengthMm: expect.any(Number) }),
      ]),
    }));
  });
});
