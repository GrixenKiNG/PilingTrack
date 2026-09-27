import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACCESS_MATRIX } from '../../domain/access-matrix';
import { PrismaAuditRepository } from '../../infrastructure/audit/audit-repository';

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock('@/lib/db', () => ({ db: mocks.db }));

import { publishAccessMatrix, saveAccessMatrixDraft } from '../access-matrix-service';

const tenantId = 'tenant-a';
const actor = { id: 'admin-1', name: 'Администратор', role: 'ADMIN', actingAs: 'MECHANIC' };

type MatrixRow = {
  id: string; tenantId: string; status: string; version: string;
  grants: unknown; updatedAt: Date; updatedBy: string | null; publishedAt: Date | null;
};

/**
 * Постановка заменяет и `db`, и транзакцию: цепочка аудита пишется той же
 * транзакцией, что и публикация, поэтому `$transaction` отдаёт тот же клиент.
 * Цепочечный писатель при этом настоящий — строка проходит через
 * `appendAuditEvent`, получая номер, предыдущий хеш и хеш звена.
 */
function installDb(rows: MatrixRow[]) {
  const auditRows: Array<Record<string, unknown>> = [];
  const chain = { lastSequence: BigInt(0), headHash: null as Uint8Array | null };
  const readinessAccessMatrix = {
    findMany: async ({ where }: { where: { tenantId: string; status: { in: string[] } } }) =>
      rows.filter((row) => row.tenantId === where.tenantId && where.status.in.includes(row.status)),
    findFirst: async ({ where }: { where: { tenantId: string; status?: string } }) =>
      rows.find((row) => row.tenantId === where.tenantId
        && (where.status === undefined || row.status === where.status)) ?? null,
    create: async ({ data }: { data: Omit<MatrixRow, 'id' | 'updatedAt'> }) => {
      const row = { id: `matrix-${rows.length + 1}`, updatedAt: new Date(), ...data } as MatrixRow;
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<MatrixRow> }) => {
      const row = rows.find((item) => item.id === where.id) as MatrixRow;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: { tenantId: string; status: string }; data: Partial<MatrixRow> }) => {
      let count = 0;
      for (const row of rows) {
        if (row.tenantId === where.tenantId && row.status === where.status) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };
  // Поиск черновика должен идти той же транзакцией под advisory-замком: чтение
  // через глобальный `db` (в обход замка) — ровно та гонка, ради которой замок
  // берётся (F-R38-10). Вызов вне транзакции помечаем отдельной заглушкой.
  const dbFindFirst = vi.fn(async () => null);
  const tx = {
    readinessAccessMatrix,
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return data;
      }),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string; hash: { not: null } } }) =>
        auditRows
          .filter((row) => row.tenantId === where.tenantId && row.hash != null)
          .sort((left, right) => Number((left.sequence as bigint) - (right.sequence as bigint)))),
    },
    tenantAuditChain: {
      findUnique: vi.fn(async () => ({ lastSequence: chain.lastSequence, headHash: chain.headHash })),
      updateMany: vi.fn(async ({ data }: { data: { lastSequence: bigint; headHash: Uint8Array } }) => {
        chain.lastSequence = data.lastSequence;
        chain.headHash = data.headHash;
        return { count: 1 };
      }),
    },
    $queryRaw: vi.fn(async () => [{ lastSequence: chain.lastSequence, headHash: chain.headHash }]),
    $executeRaw: vi.fn(async () => 1),
  };
  const client = {
    ...tx,
    readinessAccessMatrix: { ...readinessAccessMatrix, findFirst: dbFindFirst },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(tx)),
  };
  for (const key of Object.keys(mocks.db)) delete mocks.db[key];
  Object.assign(mocks.db, client);
  return { rows, auditRows, client, tx, dbFindFirst };
}

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

describe('readiness access matrix audit trail', () => {
  it('publishes the draft through the chained writer so the entry reaches the journal', async () => {
    const grants = structuredClone(DEFAULT_ACCESS_MATRIX.grants);
    // Действующая строка без автора: у матрицы из базы необязательные поля
    // лежат ключом со значением `undefined`, и цепочечная запись на них падала.
    const { auditRows, client } = installDb([
      {
        id: 'matrix-published', tenantId, status: 'PUBLISHED', version: 'v1.0', grants,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'), updatedBy: null, publishedAt: null,
      },
      {
        id: 'matrix-draft', tenantId, status: 'DRAFT', version: 'v1.1', grants,
        updatedAt: new Date('2026-09-02T00:00:00.000Z'), updatedBy: actor.id, publishedAt: null,
      },
    ]);

    await publishAccessMatrix(tenantId, actor);

    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    const data = auditRows[0];
    expect(data.sequence).toBe(BigInt(1));
    expect(data.hash).toBeInstanceOf(Uint8Array);
    expect(data.action).toBe('published');
    expect(data.entity).toBe('ReadinessAccessMatrix');
    expect(data.entityType).toBe('ReadinessAccessMatrix');
    expect(data.entityId).toBe('matrix-draft');
    expect(data.tenantId).toBe(tenantId);
    expect(data.userId).toBe(actor.id);
    expect(data.userName).toBe(actor.name);
    expect(data.userRole).toBe('ADMIN');
    expect(data.actingAs).toBe('MECHANIC');
    expect(data.before).toMatchObject({ version: 'v1.0', updatedBy: null });

    // Единственный читатель журнала отбирает звенья по непустому хешу.
    const { events } = await new PrismaAuditRepository(client as never).readChain(tenantId);
    expect(events.map((event) => event.action)).toEqual(['published']);
  });

  it('writes the draft save as a chained entry as well', async () => {
    const grants = structuredClone(DEFAULT_ACCESS_MATRIX.grants);
    const { auditRows } = installDb([
      {
        id: 'matrix-draft', tenantId, status: 'DRAFT', version: 'v1.1', grants,
        updatedAt: new Date('2026-09-02T00:00:00.000Z'), updatedBy: null, publishedAt: null,
      },
    ]);

    await saveAccessMatrixDraft(tenantId, { grants }, actor);

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('draft_saved');
    expect(auditRows[0].sequence).toBe(BigInt(1));
    expect(auditRows[0].hash).toBeInstanceOf(Uint8Array);
    expect(auditRows[0].userName).toBe(actor.name);
  });

  it('берёт advisory-замок на черновик организации раньше чтения и записи (F-R38-10)', async () => {
    // Замок — первый оператор внутри транзакции, чтение черновика и его запись
    // идут под ним; глобальный клиент в поиске черновика не участвует.
    const grants = structuredClone(DEFAULT_ACCESS_MATRIX.grants);
    const { tx, dbFindFirst } = installDb([]);

    await saveAccessMatrixDraft(tenantId, { grants }, actor);

    const call = tx.$queryRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual([`readiness-draft:matrix:${tenantId}`]);
    expect(dbFindFirst).not.toHaveBeenCalled();
  });

  it('публикует матрицу под тем же замком, читая черновик внутри транзакции (F-R38-10)', async () => {
    const grants = structuredClone(DEFAULT_ACCESS_MATRIX.grants);
    const { tx, dbFindFirst } = installDb([
      {
        id: 'matrix-published', tenantId, status: 'PUBLISHED', version: 'v1.0', grants,
        updatedAt: new Date('2026-09-01T00:00:00.000Z'), updatedBy: null, publishedAt: null,
      },
      {
        id: 'matrix-draft', tenantId, status: 'DRAFT', version: 'v1.1', grants,
        updatedAt: new Date('2026-09-02T00:00:00.000Z'), updatedBy: actor.id, publishedAt: null,
      },
    ]);

    await publishAccessMatrix(tenantId, actor);

    const call = tx.$queryRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual([`readiness-draft:matrix:${tenantId}`]);
    expect(dbFindFirst).not.toHaveBeenCalled();
  });
});
