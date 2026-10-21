/**
 * Crew Repository — потеря обновлений при конкурентном сохранении.
 *
 * Раньше save делал безусловный upsert по id: устаревшая запись второго запроса
 * затирала переименование первого, возвращала расформированную бригаду
 * (isActive: true) и воскрешала бригаду, удалённую между чтением и записью.
 * Теперь сохранение загруженной бригады условно по updatedAt, прочитанному в
 * findById, а новая бригада создаётся через create.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrewAggregate } from '../../domain';

type Row = {
  id: string;
  name: string;
  operatorId: string;
  equipmentId: string;
  siteId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const h = vi.hoisted(() => {
  let row: Row | null = null;

  const touch = (value: Row): Row => ({ ...value, updatedAt: new Date(value.updatedAt.getTime() + 1) });

  const crew = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      row && row.id === where.id ? { ...row } : null),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'createdAt' | 'updatedAt'> }) => {
      if (row) throw new Error('Unique constraint failed on id');
      const now = new Date('2026-10-01T10:00:00.000Z');
      row = { ...data, createdAt: now, updatedAt: now };
      return { ...row };
    }),
    // Как Prisma: @updatedAt проставляется базой/клиентом на каждой записи.
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
    crew,
    site: { findUnique: vi.fn(async () => ({ tenantId: 'tenant-1' })) },
    outboxEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
  };

  return {
    crew,
    tx,
    db: {
      crew,
      $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    },
    seed(value: Row | null) {
      row = value ? { ...value } : null;
    },
    row: () => (row ? { ...row } : null),
    // Другой запрос успел сохранить своё изменение между чтением и записью.
    commitExternally(patch: Partial<Row>) {
      if (!row) throw new Error('нет строки');
      row = touch({ ...row, ...patch });
    },
    removeExternally() {
      row = null;
    },
  };
});

vi.mock('@/lib/db', () => ({ db: h.db, DEFAULT_TX_OPTIONS: {} }));

import { PrismaCrewRepository } from '../crew.repository';

const initial: Row = {
  id: 'crew-1',
  name: 'Исходная',
  operatorId: 'operator-1',
  equipmentId: 'equipment-1',
  siteId: 'site-1',
  isActive: true,
  createdAt: new Date('2026-10-01T09:00:00.000Z'),
  updatedAt: new Date('2026-10-01T09:00:00.000Z'),
};

describe('PrismaCrewRepository.save — конкурентное сохранение', () => {
  let repoA: PrismaCrewRepository;
  let repoB: PrismaCrewRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    h.seed(initial);
    repoA = new PrismaCrewRepository();
    repoB = new PrismaCrewRepository();
  });

  it('устаревшая запись не затирает переименование', async () => {
    const a = await repoA.findById('crew-1');
    const b = await repoB.findById('crew-1');
    if (!a || !b) throw new Error('бригада не загружена');

    a.update({ name: 'Новое имя' });
    await repoA.save(a);

    b.assignOperator('operator-2');
    const hook = vi.fn();
    await expect(repoB.save(b, { onBeforeCommit: hook })).rejects.toMatchObject({ status: 409 });

    expect(h.row()).toMatchObject({ name: 'Новое имя', operatorId: 'operator-1' });
    expect(hook).not.toHaveBeenCalled();
    // В outbox попали только события первой, успешной записи.
    expect(h.tx.outboxEvent.createMany).toHaveBeenCalledTimes(1);
    // События отклонённой записи остаются в агрегате для повтора.
    expect(b.getPendingEvents()).toHaveLength(1);
  });

  it('устаревшая запись не возвращает расформированную бригаду', async () => {
    const a = await repoA.findById('crew-1');
    const b = await repoB.findById('crew-1');
    if (!a || !b) throw new Error('бригада не загружена');

    a.deactivate();
    await repoA.save(a);

    b.assignOperator('operator-2');
    await expect(repoB.save(b)).rejects.toMatchObject({ status: 409 });

    expect(h.row()?.isActive).toBe(false);
  });

  it('не воскрешает бригаду, удалённую между чтением и записью', async () => {
    const a = await repoA.findById('crew-1');
    if (!a) throw new Error('бригада не загружена');

    h.removeExternally();
    a.update({ name: 'Новое имя' });

    await expect(repoA.save(a)).rejects.toMatchObject({ status: 409 });
    expect(h.row()).toBeNull();
    expect(h.tx.outboxEvent.createMany).not.toHaveBeenCalled();
  });

  it('сохраняет без конфликта, если после чтения никто не менял строку', async () => {
    const a = await repoA.findById('crew-1');
    if (!a) throw new Error('бригада не загружена');

    a.update({ name: 'Новое имя' });
    await repoA.save(a);
    expect(h.row()?.name).toBe('Новое имя');

    // Следующая команда читает свежую версию и тоже проходит.
    const next = await repoB.findById('crew-1');
    if (!next) throw new Error('бригада не загружена');
    next.assignOperator('operator-2');
    await repoB.save(next);
    expect(h.row()).toMatchObject({ name: 'Новое имя', operatorId: 'operator-2' });
  });

  it('конфликт видит и запись, зафиксированную вне репозитория', async () => {
    const a = await repoA.findById('crew-1');
    if (!a) throw new Error('бригада не загружена');

    h.commitExternally({ equipmentId: 'equipment-2' });
    a.update({ name: 'Новое имя' });

    await expect(repoA.save(a)).rejects.toMatchObject({ status: 409 });
    expect(h.row()?.equipmentId).toBe('equipment-2');
  });

  it('новая бригада создаётся через create, а не через upsert', async () => {
    const created = CrewAggregate.create(
      { name: 'Новая', operatorId: 'operator-1', equipmentId: 'equipment-1', siteId: 'site-1' },
      'user-1',
    );
    h.seed(null);

    await repoA.save(created);

    expect(h.crew.create).toHaveBeenCalledTimes(1);
    expect(h.crew.upsert).not.toHaveBeenCalled();
    expect(h.row()?.name).toBe('Новая');
  });
});
