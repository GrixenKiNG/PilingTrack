/**
 * Осмотр — конкурентные записи ответов (находки Codex XP42).
 *
 * 1) Завершение читает ответы до транзакции; новые ответы, сохранённые между
 *    чтением и записью, не должны уходить под подпись и расчёт допуска.
 * 2) saveAnswers полностью заменяет набор ответов; клиент, который прислал
 *    версию (updatedAt) прочитанного осмотра, не должен затирать более свежие
 *    ответы другого клиента.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  read: vi.fn(),
  claim: vi.fn(),
  deleteAnswers: vi.fn(),
  createAnswers: vi.fn(),
  photos: vi.fn(),
  outbox: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    inspection: {
      findUnique: h.read,
      findUniqueOrThrow: h.read,
      updateMany: h.claim,
    },
    inspectionAnswer: {
      deleteMany: h.deleteAnswers,
      createMany: h.createAnswers,
    },
    outboxEvent: { createMany: h.outbox },
  };

  return {
    db: {
      ...tx,
      media: { groupBy: h.photos },
      equipment: { findFirst: vi.fn(async () => ({ name: 'Копёр' })) },
      $transaction: (body: (client: typeof tx) => Promise<unknown>) =>
        body(tx),
    },
  };
});

vi.mock('@/core/notifications/durable-alert', () => ({
  enqueueCriticalDefects: vi.fn(),
}));

vi.mock('@/modules/audit', () => ({
  recordAuditEvent: vi.fn(),
  recordAuditEventInTx: vi.fn(async () => undefined),
}));

vi.mock('@/modules/equipment', () => ({
  recordMeterReadingInTx: vi.fn(),
}));

vi.mock('@/modules/readiness/server', () => ({
  createRepairOrderForDefect: vi.fn(),
}));
vi.mock('@/core/outbox/readiness-snapshot-request', () => ({
  requestReadinessSnapshot: vi.fn(),
}));

vi.mock('../../../domain/inspection-logic', () => ({
  computeHealthScore: vi.fn(() => 100),
  findMissing: vi.fn(() => ({
    missingAnswers: [],
    missingPhotos: [],
    missingPhotosOnFault: [],
  })),
}));

vi.mock('../../../domain/defect-rules', () => ({
  inspectionDefectKey: vi.fn(),
  planDefectsFromInspection: vi.fn(() => []),
}));

vi.mock('../../../domain/block-composition', () => ({
  composeChecklist: vi.fn(),
  selectBlocks: vi.fn(),
  requiredBlockTypes: vi.fn(),
}));

vi.mock('../../../domain/phase-split', () => ({
  itemsForPhase: vi.fn(),
}));

import {
  completeInspectionWithOutcome,
  saveAnswers,
  type AnswerInput,
} from '../inspection-commands';

const tenantId = 'tenant-1';
const id = 'inspection-1';
const initialAt = new Date('2026-01-01T00:00:00.000Z');

type ClaimInput = {
  where: {
    id: string;
    tenantId: string;
    status: { not: string };
    updatedAt?: Date;
  };
  data: {
    updatedAt?: Date;
    status?: string;
    healthScore?: number;
    signedByName?: string;
    signedAt?: Date;
  };
};

function installStore(initialAnswers: AnswerInput[]) {
  let row = {
    id,
    tenantId,
    performedById: 'operator-1',
    equipmentId: 'equipment-1',
    status: 'DRAFT',
    level: 'EO',
    maintenanceRecordId: null,
    engineHours: null,
    templateSnapshot: [],
    healthScore: 100,
    updatedAt: new Date(initialAt),
    answers: structuredClone(initialAnswers),
  };

  h.read.mockImplementation(async () => structuredClone(row));

  h.claim.mockImplementation(async ({ where, data }: ClaimInput) => {
    const matches =
      where.id === row.id &&
      where.tenantId === row.tenantId &&
      row.status !== where.status.not &&
      (where.updatedAt === undefined ||
        where.updatedAt.getTime() === row.updatedAt.getTime());

    if (!matches) return { count: 0 };

    row = { ...row, ...data };
    return { count: 1 };
  });

  h.deleteAnswers.mockImplementation(async () => {
    const count = row.answers.length;
    row.answers = [];
    return { count };
  });

  h.createAnswers.mockImplementation(
    async ({ data }: { data: AnswerInput[] }) => {
      row.answers = structuredClone(data);
      return { count: data.length };
    },
  );

  return {
    current: () => row,
    commitAnswers(answers: AnswerInput[], updatedAt: Date) {
      row = {
        ...row,
        answers: structuredClone(answers),
        updatedAt: new Date(updatedAt),
      };
    },
  };
}

// Старая сигнатура допускает такое присваивание в TypeScript,
// но игнорирует четвёртый аргумент. Исправленная использует его.
const saveAtVersion: (
  id: string,
  answers: AnswerInput[],
  ctx: { tenantId: string },
  expectedUpdatedAt: Date,
) => ReturnType<typeof saveAnswers> = saveAnswers;

beforeEach(() => {
  for (const mock of Object.values(h)) mock.mockReset();
  h.photos.mockResolvedValue([]);
  h.outbox.mockResolvedValue({ count: 1 });
});

describe('XP42: версии ответов осмотра', () => {
  it(
    'отклоняет завершение, если после чтения ответов сохранена новая версия',
    async () => {
      const original = [{ itemId: 'item-a', result: 'OK' }];
      const changed = [{ itemId: 'item-a', result: 'FAULT' }];
      const store = installStore(original);

      // complete уже прочитал original на строке 337.
      // Во время следующего await моделируем коммит saveAnswers.
      h.photos.mockImplementationOnce(async () => {
        store.commitAnswers(
          changed,
          new Date(initialAt.getTime() + 1),
        );
        return [];
      });

      await expect(
        completeInspectionWithOutcome(id, {
          tenantId,
          signedByName: 'Оператор',
        }),
      ).rejects.toThrow('Ответы осмотра изменились');

      expect(store.current().status).toBe('DRAFT');
      expect(store.current().answers).toEqual(changed);
      expect(h.outbox).not.toHaveBeenCalled();
    },
  );

  it(
    'отклоняет устаревший полный набор второго клиента и сохраняет изменения первого',
    async () => {
      const store = installStore([
        { itemId: 'item-a', result: 'OK' },
        { itemId: 'item-b', result: 'OK' },
      ]);

      // Оба клиента открыли initialAt.
      const firstClient = [
        { itemId: 'item-a', result: 'FAULT' },
        { itemId: 'item-b', result: 'OK' },
      ];
      const staleSecondClient = [
        { itemId: 'item-a', result: 'OK' },
        { itemId: 'item-b', result: 'FAULT' },
      ];

      await saveAtVersion(
        id, firstClient, { tenantId }, new Date(initialAt),
      );

      expect(store.current().updatedAt.getTime())
        .toBeGreaterThan(initialAt.getTime());

      await expect(
        saveAtVersion(
          id,
          staleSecondClient,
          { tenantId },
          new Date(initialAt),
        ),
      ).rejects.toThrow('Осмотр изменён другим запросом');

      expect(
        store.current().answers.map(({ itemId, result }) => ({
          itemId,
          result,
        })),
      ).toEqual(firstClient);

      // Отклонённый запрос не должен удалять сохранённые ответы.
      expect(h.deleteAnswers).toHaveBeenCalledTimes(1);
      expect(h.createAnswers).toHaveBeenCalledTimes(1);
    },
  );
});
