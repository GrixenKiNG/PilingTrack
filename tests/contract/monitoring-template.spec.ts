import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { moduleLayoutTemplate: { findUnique: vi.fn(), create: vi.fn() } },
}));

import { db } from '@/lib/db';
import { getLayoutSnapshot } from '@/modules/layout';
import { getTemplate, saveTemplate } from '@/modules/monitoring/application/template-service';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '@/components/piling/monitoring/equipment-tile-template';

const findUniqueMock = db.moduleLayoutTemplate.findUnique as unknown as Mock;
const createMock = db.moduleLayoutTemplate.create as unknown as Mock;

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

  it('creates a valid template under the monitoring surface', async () => {
    createMock.mockImplementation(async ({ data }: { data: { template: unknown } }) => ({ id: 'row', updatedAt: new Date('2026-01-01'), template: data.template }));
    const res = await saveTemplate('orion', DEFAULT_EQUIPMENT_TILE_TEMPLATE, 'user1', (await getLayoutSnapshot('orion', 'monitoring-equipment-tile')).revision);
    expect(res.version).toBe(1);
    expect(createMock).toHaveBeenCalledOnce();
    const call = createMock.mock.calls[0][0] as { data: { surfaceId: string } };
    expect(call.data.surfaceId).toBe('monitoring-equipment-tile');
  });
});
