/**
 * Матрица доступов — потеря обновления при сохранении черновика (находка Codex XP38).
 *
 * Блокировка в saveAccessMatrixDraft защищает от двух черновиков, но не от
 * того, что второй администратор с устаревшей матрицей молча перезаписывает
 * правку первого: экран присылает матрицу целиком. Клиент теперь присылает
 * версию, на которой основана правка, а сервер сверяет её под блокировкой.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Grants = { read: boolean; manage: boolean };
  type Row = {
    id: string;
    tenantId: string;
    status: string;
    version: string;
    grants: Grants;
    updatedAt: Date;
    updatedBy: string | null;
    publishedAt: Date | null;
  };
  type Write = Pick<Row, 'version' | 'grants' | 'updatedBy'>;
  const rows: Row[] = [];

  const readinessAccessMatrix = {
    findMany: vi.fn(async () => structuredClone(rows)),
    findFirst: vi.fn(async (
      args: { where: { tenantId: string; status: string } },
    ) => rows.find(row =>
      row.tenantId === args.where.tenantId &&
      row.status === args.where.status
    ) ?? null),
    create: vi.fn(async (
      args: {
        data: Write & { tenantId: string; status: string };
      },
    ) => {
      const row: Row = {
        ...args.data,
        id: 'draft',
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        publishedAt: null,
      };
      rows.push(row);
      return structuredClone(row);
    }),
    update: vi.fn(async (
      args: { where: { id: string }; data: Write },
    ) => {
      const row = rows.find(item => item.id === args.where.id);
      if (!row) throw new Error('Missing matrix');
      Object.assign(row, args.data);
      return structuredClone(row);
    }),
  };

  const tx = {
    readinessAccessMatrix,
    $executeRaw: vi.fn(async () => 1),
  };

  return {
    rows,
    readinessAccessMatrix,
    transaction: vi.fn(async (
      callback: (client: typeof tx) => Promise<unknown>,
    ) => callback(tx)),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    readinessAccessMatrix: h.readinessAccessMatrix,
    $transaction: h.transaction,
  },
}));

vi.mock('../../domain/access-matrix', () => ({
  DEFAULT_ACCESS_MATRIX: {
    version: '1',
    status: 'PUBLISHED',
    grants: { read: false, manage: false },
  },
  sanitizeAccessMatrix: (
    input: object,
    fallback: object,
  ) => ({ ...fallback, ...input }),
  describeAccessChanges: () => [],
}));

vi.mock('../../domain/readiness-rules', () => ({
  bumpVersion: (version: string) => String(Number(version) + 1),
}));

vi.mock('../../infrastructure/audit/record-audit', () => ({
  recordChainedReadinessAudit: vi.fn(async () => undefined),
}));

import { saveAccessMatrixDraft } from '../access-matrix-service';

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.splice(0, h.rows.length, {
    id: 'published',
    tenantId: 'tenant-1',
    status: 'PUBLISHED',
    version: '1',
    grants: { read: false, manage: false },
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    updatedBy: null,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
  });
});

it('rejects a stale full matrix without overwriting the first editor', async () => {
  await saveAccessMatrixDraft(
    'tenant-1',
    { version: '1', grants: { read: true, manage: false } },
    { id: 'a', name: 'A', role: 'ADMIN' },
  );

  await expect(saveAccessMatrixDraft(
    'tenant-1',
    { version: '1', grants: { read: false, manage: true } },
    { id: 'b', name: 'B', role: 'ADMIN' },
  )).rejects.toThrow('изменена другим пользователем');

  expect(h.rows.find(row => row.status === 'DRAFT')).toMatchObject({
    version: '2',
    grants: { read: true, manage: false },
    updatedBy: 'a',
  });
  expect(h.readinessAccessMatrix.update).not.toHaveBeenCalled();
});
