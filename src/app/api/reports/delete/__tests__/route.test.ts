/**
 * DELETE /api/reports/delete — tenant scoping regression.
 *
 * Pre-existing IDOR: reportId is globally unique, so the handler deleted by
 * `db.report.delete({ where: { reportId } })` with zero tenant check — any
 * ADMIN/DISPATCHER (reports.manage_all) could delete another tenant's report.
 * Fixed to findFirst-by-tenant before the (irreversible) delete, mirroring
 * dictionary-service.ts's ownership-check-before-delete pattern.
 *
 * F-R34-1: the delete used to leave no trace at all — no audit event, no
 * ReportDeleted outbox event. It now snapshots the report, deletes it and
 * writes the domain event in ONE transaction, then records the audit event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  findFirstMock,
  deleteMock,
  outboxCreateMock,
  feedbackCreateMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstMock: vi.fn(),
  deleteMock: vi.fn(),
  outboxCreateMock: vi.fn(),
  feedbackCreateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: loggerErrorMock } }));
// Сброс кэша журнала отчётов (0eca0a0d) — отдельно проверен в cached-queries; здесь не нужен.
vi.mock('@/lib/cached-queries', () => ({ invalidateReports: vi.fn() }));
vi.mock('@/lib/db', () => {
  const tx = {
    report: { findFirst: findFirstMock, delete: deleteMock },
    outboxEvent: { create: outboxCreateMock },
  };
  return {
    DEFAULT_TX_OPTIONS: {},
    db: {
      $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx),
      report: { findFirst: findFirstMock, delete: deleteMock, findMany: vi.fn().mockResolvedValue([]) },
      reportAnalytics: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      siteDailySummary: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      feedbackEvent: { create: feedbackCreateMock },
    },
  };
});

import { DELETE } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

/** Отчёт со всей выработкой дня: 20 свай (12 по 12 м + 8 без длины), 40,5 м бурения, 2,5 ч простоя. */
const REPORT_ROW = {
  id: 'internal-1',
  reportId: 'report-1',
  date: '2026-09-26',
  siteId: 'site-1',
  userId: 'user-1',
  version: 3,
  site: { name: 'Северный' },
  user: { name: 'Иванов И.' },
  piles: [
    { count: 12, pileGrade: { lengthMm: 12000 } },
    { count: 8, pileGrade: { lengthMm: null } },
  ],
  drillings: [{ meters: 40.5 }],
  downtimes: [{ duration: 2.5 }],
};

function deleteReq(reportId: string): NextRequest {
  return new NextRequest('http://localhost/api/reports/delete', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reportId }),
  });
}

describe('DELETE /api/reports/delete — tenant scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
  });

  it('scopes the lookup by the caller tenantId, not reportId alone', async () => {
    findFirstMock.mockResolvedValue(REPORT_ROW);
    deleteMock.mockResolvedValue({ id: 'internal-1' });

    const res = await DELETE(deleteReq('report-1'));

    expect(res.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reportId: 'report-1', tenantId: 'tenant-a' } })
    );
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'internal-1' } });
  });

  it('returns 404 (not the other tenant\'s report) when the report belongs to a different tenant', async () => {
    findFirstMock.mockResolvedValue(null);

    const res = await DELETE(deleteReq('report-owned-by-tenant-b'));

    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('fails closed (400) without querying when the session has no tenant', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: null }, error: null });

    const res = await DELETE(deleteReq('report-1'));

    expect(res.status).toBe(403);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('returns 404 on a delete-time race instead of leaking a 500', async () => {
    findFirstMock.mockResolvedValue(REPORT_ROW);
    deleteMock.mockRejectedValue(new Error('Record to delete does not exist.'));

    const res = await DELETE(deleteReq('report-1'));

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/reports/delete — след удаления (F-R34-1)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    findFirstMock.mockResolvedValue(REPORT_ROW);
    deleteMock.mockResolvedValue({ id: 'internal-1' });
  });

  it('emits ReportDeleted with the tenant and the snapshot of what was deleted', async () => {
    await DELETE(deleteReq('report-1'));

    expect(outboxCreateMock).toHaveBeenCalledTimes(1);
    const { data } = outboxCreateMock.mock.calls[0][0];
    expect(data.type).toBe('ReportDeleted');
    expect(data.aggregateId).toBe('report-1');
    expect(data.tenantId).toBe('tenant-a');
    // siteId/userId обязаны доехать в конверте события: строки отчёта, по
    // которой их можно было бы дочитать, к моменту обработки уже нет.
    expect(data.payload.siteId).toBe('site-1');
    expect(data.payload.userId).toBe('user-1');
    expect(data.payload.data).toMatchObject({
      reportId: 'report-1',
      date: '2026-09-26',
      siteId: 'site-1',
      totalPiles: 20,
      totalPileMeters: 144,
      totalDrillingMeters: 40.5,
      totalDowntimeHours: 2.5,
    });
  });

  it('records the audit event «Отчёт удалён» with the actor, tenant and before-snapshot', async () => {
    await DELETE(deleteReq('report-1'));

    expect(feedbackCreateMock).toHaveBeenCalledTimes(1);
    const { data } = feedbackCreateMock.mock.calls[0][0];
    expect(data).toMatchObject({
      level: 'warn',
      scope: 'reports',
      action: 'report.deleted',
      title: 'Отчёт удалён',
      actorId: 'admin-1',
      actorName: 'Админ А.',
      targetId: 'report-1',
    });
    expect(data.metadata.tenantId).toBe('tenant-a');
    // Дата в тексте — ДД.ММ.ГГГГ, а не сырой ISO из БД (F-R34-1b).
    expect(data.message).toContain('26.09.2026');
    expect(data.metadata.before).toMatchObject({
      reportId: 'report-1',
      date: '2026-09-26',
      siteId: 'site-1',
      siteName: 'Северный',
      operatorId: 'user-1',
      operatorName: 'Иванов И.',
      totalPiles: 20,
      totalPileMeters: 144,
      totalDrillingMeters: 40.5,
      totalDowntimeHours: 2.5,
    });
  });

  it('writes neither the event nor the audit trail when the report is not found', async () => {
    findFirstMock.mockResolvedValue(null);

    const res = await DELETE(deleteReq('missing'));

    expect(res.status).toBe(404);
    expect(outboxCreateMock).not.toHaveBeenCalled();
    expect(feedbackCreateMock).not.toHaveBeenCalled();
  });

  it('answers 200 and logs the failure when the audit write throws (F-R34-1b)', async () => {
    // Отчёт уже удалён транзакцией: падение записи следа не должно
    // оборачиваться в 500, иначе админ повторит удаление и получит 404.
    feedbackCreateMock.mockRejectedValue(new Error('feedback write failed'));

    const res = await DELETE(deleteReq('report-1'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Report delete: audit write failed',
      expect.any(Error),
      { reportId: 'report-1' }
    );
  });

  it('does not log an audit failure when the write succeeds', async () => {
    feedbackCreateMock.mockResolvedValue({ id: 'feedback-1' });

    const res = await DELETE(deleteReq('report-1'));

    expect(res.status).toBe(200);
    // Пересчёт проекций на этом моке падает сам по себе (db.report.findMany
    // сброшен resetAllMocks) — проверяем именно отсутствие записи о следе.
    const auditFailures = loggerErrorMock.mock.calls.filter(
      ([message]) => message === 'Report delete: audit write failed'
    );
    expect(auditFailures).toHaveLength(0);
  });
});
