import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { moduleLayoutTemplate: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

import { db } from '@/lib/db';
import { getTemplate, saveTemplate } from '@/modules/monitoring/application/template-service';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '@/components/piling/monitoring/equipment-tile-template';

const findUniqueMock = db.moduleLayoutTemplate.findUnique as unknown as Mock;
const upsertMock = db.moduleLayoutTemplate.upsert as unknown as Mock;

describe('monitoring template service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the default template when no row exists', async () => {
    findUniqueMock.mockResolvedValue(null);
    const t = await getTemplate('orion');
    expect(t.version).toBe(DEFAULT_EQUIPMENT_TILE_TEMPLATE.version);
    expect(Array.isArray(t.blocks)).toBe(true);
  });

  it('rejects an invalid template on save', async () => {
    await expect(saveTemplate('orion', { nope: true }, 'user1')).rejects.toThrow();
  });

  it('upserts a valid template under the monitoring surface', async () => {
    upsertMock.mockImplementation(async ({ create }: { create: { template: unknown } }) => ({ template: create.template }));
    const res = await saveTemplate('orion', DEFAULT_EQUIPMENT_TILE_TEMPLATE, 'user1');
    expect(res.version).toBe(1);
    expect(upsertMock).toHaveBeenCalledOnce();
    const call = upsertMock.mock.calls[0][0] as { create: { surfaceId: string } };
    expect(call.create.surfaceId).toBe('monitoring-equipment-tile');
  });
});
