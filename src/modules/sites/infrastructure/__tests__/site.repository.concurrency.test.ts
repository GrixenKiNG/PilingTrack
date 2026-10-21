/**
 * Site Repository — потеря обновлений при конкурентном сохранении.
 *
 * Раньше save делал безусловный upsert по id: устаревшая запись второго запроса
 * снова включала деактивированный объект, затирала чужое переименование и
 * воскрешала объект, удалённый между чтением и записью. Теперь загруженный
 * объект пишется условно по updatedAt, прочитанному в findById, а новый
 * создаётся через create.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SiteAggregate } from '../../domain';

type Row = {
  id: string;
  name: string;
  tenantId: string | null;
  status: string;
  plannedPiles: number;
  plannedDrilling: number;
  latitude: number | null;
  longitude: number | null;
  completionDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const h = vi.hoisted(() => {
  let row: Row | null = null;

  const touch = (value: Row): Row => ({ ...value, updatedAt: new Date(value.updatedAt.getTime() + 1) });

  const site = {
    findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) =>
      row && row.id === where.id && row.tenantId === where.tenantId ? { ...row } : null),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'createdAt' | 'updatedAt'> }) => {
      if (row) throw new Error('Unique constraint failed on id');
      const now = new Date('2026-10-01T10:00:00.000Z');
      row = { ...data, createdAt: now, updatedAt: now };
      return { ...row };
    }),
    // Как Prisma: @updatedAt проставляется на каждой записи.
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; updatedAt?: Date }; data: Partial<Row> }) => {
      if (!row || row.id !== where.id) return { count: 0 };
      if (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
      row = touch({ ...row, ...data });
      return { count: 1 };
    }),
    // Безусловная запись: поведение прежнего кода. После правки не вызывается.
    upsert: vi.fn(async ({ create, update }: { create: Omit<Row, 'createdAt' | 'updatedAt'>; update: Partial<Row> }) => {
      if (row) {
        row = touch({ ...row, ...update });
      } else {
        const now = new Date('2026-10-01T10:00:00.000Z');
        row = { ...create, createdAt: now, updatedAt: now };
      }
      return { ...row };
    }),
  };

  const tx = {
    site,
    outboxEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
  };

  return {
    site,
    tx,
    db: {
      site,
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    },
    seed(value: Row | null) {
      row = value ? { ...value } : null;
    },
    row: () => (row ? { ...row } : null),
    removeExternally() {
      row = null;
    },
  };
});

vi.mock('@/lib/db', () => ({ db: h.db }));

import { PrismaSiteRepository } from '../site.repository';

const initial: Row = {
  id: 'site-1',
  name: 'Исходное название',
  tenantId: 'tenant-1',
  status: 'ACTIVE',
  plannedPiles: 10,
  plannedDrilling: 0,
  latitude: null,
  longitude: null,
  completionDate: null,
  isActive: true,
  createdAt: new Date('2026-10-01T09:00:00.000Z'),
  updatedAt: new Date('2026-10-01T09:00:00.000Z'),
};

describe('PrismaSiteRepository.save — конкурентное сохранение', () => {
  let repoA: PrismaSiteRepository;
  let repoB: PrismaSiteRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    h.seed(initial);
    repoA = new PrismaSiteRepository();
    repoB = new PrismaSiteRepository();
  });

  it('устаревшая запись не включает обратно деактивированный объект', async () => {
    const a = await repoA.findById('site-1', 'tenant-1');
    const b = await repoB.findById('site-1', 'tenant-1');
    if (!a || !b) throw new Error('объект не загружен');

    a.deactivate();
    await repoA.save(a);

    b.update({ name: 'Новое название' });
    await expect(repoB.save(b)).rejects.toMatchObject({ status: 409 });

    expect(h.row()).toMatchObject({ isActive: false, status: 'INACTIVE', name: 'Исходное название' });
    expect(h.tx.outboxEvent.createMany).toHaveBeenCalledTimes(1);
    // События отклонённой записи остаются в агрегате для повтора.
    expect(b.getPendingEvents()).toHaveLength(1);
  });

  it('устаревшая запись не затирает чужое изменение плана', async () => {
    const a = await repoA.findById('site-1', 'tenant-1');
    const b = await repoB.findById('site-1', 'tenant-1');
    if (!a || !b) throw new Error('объект не загружен');

    a.update({ plannedPiles: 500 });
    await repoA.save(a);

    b.update({ name: 'Другое название' });
    await expect(repoB.save(b)).rejects.toMatchObject({ status: 409 });

    expect(h.row()).toMatchObject({ plannedPiles: 500, name: 'Исходное название' });
  });

  it('не воскрешает объект, удалённый между чтением и записью', async () => {
    const a = await repoA.findById('site-1', 'tenant-1');
    if (!a) throw new Error('объект не загружен');

    h.removeExternally();
    a.update({ name: 'Новое название' });

    await expect(repoA.save(a)).rejects.toMatchObject({ status: 409 });
    expect(h.row()).toBeNull();
    expect(h.tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('сохраняет без конфликта, если после чтения никто не менял строку', async () => {
    const a = await repoA.findById('site-1', 'tenant-1');
    if (!a) throw new Error('объект не загружен');

    a.update({ name: 'Новое название' });
    await repoA.save(a);
    expect(h.row()?.name).toBe('Новое название');

    // Следующая команда читает свежую версию и тоже проходит.
    const next = await repoB.findById('site-1', 'tenant-1');
    if (!next) throw new Error('объект не загружен');
    next.update({ plannedPiles: 20 });
    await repoB.save(next);
    expect(h.row()).toMatchObject({ name: 'Новое название', plannedPiles: 20 });
  });

  it('новый объект создаётся через create, а не через upsert', async () => {
    const created = SiteAggregate.create({ name: 'Новый объект', tenantId: 'tenant-1' });
    h.seed(null);

    await repoA.save(created);

    expect(h.site.create).toHaveBeenCalledTimes(1);
    expect(h.site.upsert).not.toHaveBeenCalled();
    expect(h.row()?.name).toBe('Новый объект');
  });
});
