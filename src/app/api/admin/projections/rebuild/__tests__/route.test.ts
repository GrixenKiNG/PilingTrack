/**
 * POST /api/admin/projections/rebuild — след пересборки проекций (F-R34-23).
 *
 * Пересборка переписывает витрины и аналитику по одному запросу, и раньше от
 * неё не оставалось ничего: на вопрос «почему у меня другие числа, чем вчера»
 * ответить было нечем. Роут пишет событие `projections.rebuilt` с именами
 * пересобранных проекций, числом записанных строк и актором. Запись
 * best-effort: сбой следа не должен превращать успешную пересборку в 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock,
  rebuildAllMock,
  rebuildAnalyticsMock,
  rebuildDailyMock,
  rebuildWeeklyMock,
  recordAuditEventMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  rebuildAllMock: vi.fn(),
  rebuildAnalyticsMock: vi.fn(),
  rebuildDailyMock: vi.fn(),
  rebuildWeeklyMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: vi.fn() }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/reports/application/projections/rebuild', () => ({
  rebuildAll: rebuildAllMock,
  rebuildReportAnalytics: rebuildAnalyticsMock,
  rebuildSiteDailySummary: rebuildDailyMock,
  rebuildSiteWeeklyTrend: rebuildWeeklyMock,
}));

import { POST } from '../route';

const ADMIN = { id: 'admin-1', name: 'Админ А.', role: 'ADMIN', tenantId: 'tenant-a' };

const ALL_RESULTS = [
  { name: 'report-analytics', rowsWritten: 10, durationMs: 5 },
  { name: 'site-daily', rowsWritten: 3, durationMs: 2 },
  { name: 'site-weekly', rowsWritten: 1, durationMs: 1 },
];

function postReq(name?: string): NextRequest {
  const url = name
    ? `http://localhost/api/admin/projections/rebuild?name=${name}`
    : 'http://localhost/api/admin/projections/rebuild';
  return new NextRequest(url, { method: 'POST' });
}

describe('POST /api/admin/projections/rebuild — след пересборки (F-R34-23)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    rebuildAllMock.mockResolvedValue(ALL_RESULTS);
    rebuildAnalyticsMock.mockResolvedValue(ALL_RESULTS[0]);
    rebuildDailyMock.mockResolvedValue(ALL_RESULTS[1]);
    rebuildWeeklyMock.mockResolvedValue(ALL_RESULTS[2]);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('пишет projections.rebuilt с именами всех пересобранных проекций и суммой строк', async () => {
    const res = await POST(postReq());

    expect(res.status).toBe(200);
    expect(rebuildAllMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'projections.rebuilt',
      scope: 'projections',
      actorId: 'admin-1',
      metadata: {
        names: ['report-analytics', 'site-daily', 'site-weekly'],
        rowsWritten: 14,
      },
    });
  });

  it('называет только выбранную проекцию, когда пересобирают одну', async () => {
    const res = await POST(postReq('site-daily'));

    expect(res.status).toBe(200);
    expect(rebuildAllMock).not.toHaveBeenCalled();
    expect(rebuildDailyMock).toHaveBeenCalledTimes(1);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'projections.rebuilt',
        actorId: 'admin-1',
        metadata: { names: ['site-daily'], rowsWritten: 3 },
      }),
    );
  });

  it('не пересобирает и не пишет след при неизвестной проекции (400)', async () => {
    const res = await POST(postReq('unknown'));

    expect(res.status).toBe(400);
    expect(rebuildAllMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('отвечает 200 и пишет ошибку в лог, когда запись следа упала', async () => {
    recordAuditEventMock.mockRejectedValue(new Error('audit down'));

    const res = await POST(postReq('report-analytics'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [ALL_RESULTS[0]] });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Projections rebuild: audit write failed',
      expect.any(Error),
      { name: 'report-analytics' },
    );
  });

  it('не пишет ошибку в лог, когда след записан успешно', async () => {
    await POST(postReq());

    const auditFailures = loggerErrorMock.mock.calls.filter(
      ([message]) => message === 'Projections rebuild: audit write failed',
    );
    expect(auditFailures).toHaveLength(0);
  });
});
