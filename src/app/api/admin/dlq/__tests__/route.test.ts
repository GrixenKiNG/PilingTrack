/**
 * GET /api/admin/dlq — W51: к странице очереди подтягивается отчёт события
 * (номер `Report.reportId` и объект `Site.name`) ОДНИМ запросом на страницу, а
 * не по строке; организация — строгим равенством, иначе фильтр вернул бы чужие
 * отчёты. Владелец должен видеть, о каком отчёте сбой, а не машинный
 * `aggregateId` (W49-DLQ-OPERATIONS, находка 1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  assertCanMock,
  reportFindManyMock,
  dlqFindManyMock,
  getPendingDlqEntriesMock,
  getDlqStatsMock,
  retryDlqEntryMock,
  recordAuditEventMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  reportFindManyMock: vi.fn(),
  dlqFindManyMock: vi.fn(),
  getPendingDlqEntriesMock: vi.fn(),
  getDlqStatsMock: vi.fn(),
  retryDlqEntryMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/modules/audit', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/core/outbox/dead-letter-queue', () => ({
  getPendingDlqEntries: getPendingDlqEntriesMock,
  getDlqStats: getDlqStatsMock,
  retryDlqEntry: retryDlqEntryMock,
  discardDlqEntry: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    report: { findMany: reportFindManyMock },
    deadLetterQueue: { findMany: dlqFindManyMock },
  },
}));

import { GET, POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const stats = { pending: 2, resolved: 0, discarded: 0, total: 2 };

function dlqEntry(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'e1',
    eventType: 'ReportSubmitted',
    aggregateId: 'RM-1',
    payload: {},
    errorMessage: 'Invalid `prisma.report.findUnique()` invocation',
    attempts: 5,
    sourceOutboxId: 'o1',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    status: 'pending' as const,
    ...over,
  };
}

function req(qs = 'status=pending'): NextRequest {
  return new NextRequest(`http://localhost/api/admin/dlq?${qs}`);
}

describe('GET /api/admin/dlq — отчёт к записям очереди (W51)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    getDlqStatsMock.mockResolvedValue(stats);
  });

  it('находит отчёты одним запросом на страницу и с организацией строгим равенством', async () => {
    getPendingDlqEntriesMock.mockResolvedValue([
      dlqEntry({ id: 'e1', aggregateId: 'RM-1' }),
      dlqEntry({ id: 'e2', aggregateId: 'RM-2' }),
    ]);
    reportFindManyMock.mockResolvedValue([{ reportId: 'RM-1', site: { name: 'Объект «Север»' } }]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(reportFindManyMock).toHaveBeenCalledTimes(1);
    expect(reportFindManyMock).toHaveBeenCalledWith({
      where: { reportId: { in: ['RM-1', 'RM-2'] }, tenantId: 'tenant-a' },
      select: { reportId: true, site: { select: { name: true } } },
    });

    const body = await res.json();
    expect(body.entries[0].report).toEqual({ reportId: 'RM-1', siteName: 'Объект «Север»' });
    // Строки отчёта нет — карточка подпишет «отчёт удалён».
    expect(body.entries[1].report).toBeNull();
  });

  it('не ходит в базу за отчётами, когда у записей нет aggregateId', async () => {
    getPendingDlqEntriesMock.mockResolvedValue([dlqEntry({ aggregateId: null })]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(reportFindManyMock).not.toHaveBeenCalled();
    expect((await res.json()).entries[0].report).toBeNull();
  });
});

describe('POST /api/admin/dlq — повтор уже переотправленной записи', () => {
  function postRetry(id: string): NextRequest {
    return new NextRequest('http://localhost/api/admin/dlq', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, action: 'retry' }),
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('второй клик отвечает 409 «Уже переотправлено» и не пишет аудит повторно', async () => {
    retryDlqEntryMock.mockResolvedValue('already_retried');

    const res = await POST(postRetry('dlq-1'));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Уже переотправлено');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('первый клик ставит повтор и пишет аудит', async () => {
    retryDlqEntryMock.mockResolvedValue('retried');

    const res = await POST(postRetry('dlq-1'));

    expect(res.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'dlq.retried', targetId: 'dlq-1' }));
  });
});
