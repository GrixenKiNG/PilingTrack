import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { moduleLayoutTemplate: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

import { db } from '@/lib/db';
import { getLayout, saveLayout, UnknownSurfaceError } from '@/modules/layout';
import { DEFAULT_EQUIPMENT_CARD_TEMPLATE } from '@/components/piling/admin-equipment/equipment-card-template';

describe('layout service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ships a valid equipment-card default template (saveable as-is)', async () => {
    (db.moduleLayoutTemplate.upsert as any).mockImplementation(async ({ create }: any) => ({ template: create.template }));
    await expect(saveLayout('orion', 'equipment-card', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1')).resolves.toBeTruthy();
  });

  it('returns the surface default when no row exists', async () => {
    (db.moduleLayoutTemplate.findUnique as any).mockResolvedValue(null);
    const t = await getLayout('orion', 'equipment-card');
    expect(t.version).toBe(1);
    expect(t.blocks.length).toBe(DEFAULT_EQUIPMENT_CARD_TEMPLATE.blocks.length);
  });

  it('rejects unknown surfaces (registry is the allow-list)', async () => {
    await expect(getLayout('orion', 'dlq')).rejects.toBeInstanceOf(UnknownSurfaceError);
    await expect(saveLayout('orion', 'dlq', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1')).rejects.toBeInstanceOf(UnknownSurfaceError);
  });

  it('fails closed on missing tenantId', async () => {
    await expect(getLayout('', 'equipment-card')).rejects.toThrow('tenantId is required');
    await expect(saveLayout('', 'equipment-card', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1')).rejects.toThrow('tenantId is required');
  });

  it('rejects a template with data keys from another surface', async () => {
    // 'photo' is a monitoring key, not an equipment-card key
    const foreign = JSON.parse(JSON.stringify(DEFAULT_EQUIPMENT_CARD_TEMPLATE));
    foreign.blocks[0] = { ...foreign.blocks[0], dataKey: 'photo' };
    await expect(saveLayout('orion', 'equipment-card', foreign, 'u1')).rejects.toThrow('Invalid layout template');
  });

  it('upserts a valid template under its surface', async () => {
    (db.moduleLayoutTemplate.upsert as any).mockImplementation(async ({ create }: any) => ({ template: create.template }));
    const res = await saveLayout('orion', 'equipment-card', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1');
    expect(res.version).toBe(1);
    const call = (db.moduleLayoutTemplate.upsert as any).mock.calls[0][0];
    expect(call.where.tenantId_surfaceId).toEqual({ tenantId: 'orion', surfaceId: 'equipment-card' });
    expect(call.create.surfaceId).toBe('equipment-card');
  });
});
