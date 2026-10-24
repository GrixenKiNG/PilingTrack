import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {
    moduleLayoutTemplate: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import { getLayout, getLayoutSnapshot, getLayoutSet, saveLayout, deleteLayout, UnknownSurfaceError } from '@/modules/layout';
import { DEFAULT_EQUIPMENT_CARD_TEMPLATE } from '@/components/piling/admin-equipment/equipment-card-template';
import { ANALYTICS_DASHBOARD_WIDGET_IDS } from '@/components/piling/analytics-dashboard/kpi-catalog';

const anyDb = db.moduleLayoutTemplate as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};

// A valid template that differs from the default (bumped minHeight).
function customTemplate() {
  const t = JSON.parse(JSON.stringify(DEFAULT_EQUIPMENT_CARD_TEMPLATE));
  t.card.minHeight = 555;
  return t;
}

describe('layout service', () => {
  beforeEach(() => { vi.clearAllMocks(); anyDb.findUnique.mockResolvedValue(null); });

  it('ships a valid equipment-card default template (saveable as-is)', async () => {
    anyDb.create.mockImplementation(async ({ data }: { data: { template: unknown } }) => ({ id: 'row', updatedAt: new Date('2026-01-01'), template: data.template }));
    await expect(saveLayout('orion', 'equipment-card', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1', '', (await getLayoutSnapshot('orion', 'equipment-card')).revision)).resolves.toBeTruthy();
  });

  it('returns the surface default when nothing is saved', async () => {
    anyDb.findUnique.mockResolvedValue(null);
    const t = await getLayout('orion', 'equipment-card');
    expect(t.card.minHeight).toBe(DEFAULT_EQUIPMENT_CARD_TEMPLATE.card.minHeight);
  });

  it('a per-entity override wins over the base', async () => {
    anyDb.findUnique.mockImplementation(async ({ where }: { where: { tenantId_surfaceId_entityId: { entityId: string } } }) => {
      if (where.tenantId_surfaceId_entityId.entityId === 'eq-1') return { id: 'row', updatedAt: new Date('2026-01-01'), entityId: 'eq-1', template: customTemplate() };
      return { id: 'row', updatedAt: new Date('2026-01-01'), entityId: '', template: DEFAULT_EQUIPMENT_CARD_TEMPLATE };
    });
    const t = await getLayout('orion', 'equipment-card', 'eq-1');
    expect(t.card.minHeight).toBe(555);
  });

  it('a tile with no override falls back to the base', async () => {
    anyDb.findUnique.mockImplementation(async ({ where }: { where: { tenantId_surfaceId_entityId: { entityId: string } } }) => {
      if (where.tenantId_surfaceId_entityId.entityId === '') return { id: 'row', updatedAt: new Date('2026-01-01'), entityId: '', template: customTemplate() };
      return null; // no override for eq-2
    });
    const t = await getLayout('orion', 'equipment-card', 'eq-2');
    expect(t.card.minHeight).toBe(555); // the base
  });

  it('getLayoutSet splits base from overrides', async () => {
    anyDb.findMany.mockResolvedValue([
      { entityId: '', template: DEFAULT_EQUIPMENT_CARD_TEMPLATE },
      { entityId: 'eq-1', template: customTemplate() },
    ]);
    const set = await getLayoutSet('orion', 'equipment-card');
    expect(set.base.card.minHeight).toBe(DEFAULT_EQUIPMENT_CARD_TEMPLATE.card.minHeight);
    expect(set.overrides['eq-1'].card.minHeight).toBe(555);
  });

  it('saves an override scoped to its entity', async () => {
    anyDb.create.mockImplementation(async ({ data }: { data: { template: unknown } }) => ({ id: 'row', updatedAt: new Date('2026-01-01'), template: data.template }));
    await saveLayout('orion', 'equipment-card', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1', 'eq-1', (await getLayoutSnapshot('orion', 'equipment-card', 'eq-1')).revision);
    const call = anyDb.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ tenantId: 'orion', surfaceId: 'equipment-card', entityId: 'eq-1' });
  });

  it('deleteLayout removes the row at that scope', async () => {
    anyDb.deleteMany.mockResolvedValue({ count: 1 });
    anyDb.findUnique.mockResolvedValue({ id: 'row', updatedAt: new Date('2026-01-01'), template: DEFAULT_EQUIPMENT_CARD_TEMPLATE });
    await deleteLayout('orion', 'equipment-card', 'eq-1', (await getLayoutSnapshot('orion', 'equipment-card', 'eq-1')).revision);
    expect(anyDb.deleteMany.mock.calls[0][0].where).toEqual({ tenantId: 'orion', surfaceId: 'equipment-card', entityId: 'eq-1', id: 'row', updatedAt: new Date('2026-01-01') });
  });

  it('returns the analytics-dashboard page-layout default (widget list)', async () => {
    anyDb.findUnique.mockResolvedValue(null);
    const t = await getLayout('orion', 'analytics-dashboard');
    expect(t.widgets.length).toBe(ANALYTICS_DASHBOARD_WIDGET_IDS.length);
    expect(t.widgets.map((w) => w.id)).toContain('kpi-drilling');
  });

  it('rejects unknown surfaces (registry is the allow-list)', async () => {
    await expect(getLayout('orion', 'dlq')).rejects.toBeInstanceOf(UnknownSurfaceError);
    await expect(saveLayout('orion', 'dlq', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1')).rejects.toBeInstanceOf(UnknownSurfaceError);
    await expect(deleteLayout('orion', 'dlq')).rejects.toBeInstanceOf(UnknownSurfaceError);
  });

  it('fails closed on missing tenantId', async () => {
    await expect(getLayout('', 'equipment-card')).rejects.toThrow('tenantId is required');
    await expect(saveLayout('', 'equipment-card', DEFAULT_EQUIPMENT_CARD_TEMPLATE, 'u1')).rejects.toThrow('tenantId is required');
  });

  it('rejects a template with data keys from another surface', async () => {
    const foreign = JSON.parse(JSON.stringify(DEFAULT_EQUIPMENT_CARD_TEMPLATE));
    foreign.blocks[0] = { ...foreign.blocks[0], dataKey: 'photo' }; // monitoring key
    await expect(saveLayout('orion', 'equipment-card', foreign, 'u1')).rejects.toThrow('Invalid layout template');
  });
});
