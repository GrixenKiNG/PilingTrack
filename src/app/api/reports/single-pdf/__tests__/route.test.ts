/**
 * GET /api/reports/single-pdf — job ownership fail-closed regression.
 *
 * getPdfJobOwnerId returns null once BullMQ prunes a completed job record
 * (removeOnComplete count-based eviction can fire well before the rendered
 * PDF's own RESULTS_TTL expires in storage). The ownership check used to be
 * skipped entirely in that case — any authenticated user could poll/download
 * any job by guessing/observing a jobId. Must fail closed instead.
 *
 * Also covers the per-user rate limit on the GET sync generation branch
 * (audit R67, F-PDF-GET-LIMIT): a top-level navigation from a foreign site
 * carries the SameSite=Lax session cookie and fires the heavy render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/lib/service-error';

const {
  requireAuthMock, getPdfJobOwnerIdMock, getPdfJobStatusMock, downloadPdfMock,
  assertCanAccessReportOwnerMock, assertCanMock, rateLimiterCheckMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getPdfJobOwnerIdMock: vi.fn(),
  getPdfJobStatusMock: vi.fn(),
  downloadPdfMock: vi.fn(),
  assertCanAccessReportOwnerMock: vi.fn(),
  assertCanMock: vi.fn(),
  // По умолчанию запрос разрешён: POST/статус-ветки ходят в тот же лимитер.
  rateLimiterCheckMock: vi.fn(async (_key: string, _config: { maxAttempts: number }) => ({
    allowed: true,
    remaining: 20,
  })),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/pdf-queue', () => ({
  getPdfJobOwnerId: getPdfJobOwnerIdMock,
  getPdfJobStatus: getPdfJobStatusMock,
  downloadPdf: downloadPdfMock,
  enqueuePdfGeneration: vi.fn(),
}));
vi.mock('@/services/auth/resource-access-service', () => ({
  assertCanAccessReportOwner: assertCanAccessReportOwnerMock,
  ensureTenantAccess: vi.fn(),
}));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/lib/pdf-generator', () => ({ generateSinglePdf: vi.fn() }));
vi.mock('@/lib/pdf-data', () => ({ loadSingleReportPdfContext: vi.fn() }));
vi.mock('@/services/feedback/feedback-event-service', () => ({ recordFeedbackEvent: vi.fn() }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: rateLimiterCheckMock },
  getRateLimitIdentifier: () => 'test-ip',
}));

import { GET, POST } from '../route';
import { loadSingleReportPdfContext } from '@/lib/pdf-data';
import { generateSinglePdf } from '@/lib/pdf-generator';
import { enqueuePdfGeneration } from '@/lib/pdf-queue';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';

const OPERATOR = { id: 'user-1', role: 'OPERATOR', tenantId: 'tenant-a' };
const DISPATCHER = { id: 'user-2', role: 'DISPATCHER', tenantId: 'tenant-a' };
const JOB_ID = '11111111-1111-1111-1111-111111111111';

function statusReq(): NextRequest {
  return new NextRequest(`http://localhost/api/reports/single-pdf?jobId=${JOB_ID}&action=status`);
}

function downloadReq(): NextRequest {
  return new NextRequest(`http://localhost/api/reports/single-pdf?jobId=${JOB_ID}&action=download`);
}

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reports/single-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/reports/single-pdf — ownership fail-closed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: OPERATOR, error: null });
    getPdfJobStatusMock.mockResolvedValue({ status: 'completed' });
  });

  it('checks reports.read_cross_user when the job record is gone (pruned)', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue(null);

    const res = await GET(statusReq());

    expect(assertCanMock).toHaveBeenCalledWith(OPERATOR, 'reports.read_cross_user');
    expect(assertCanAccessReportOwnerMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('rejects (403) a non-privileged user when the job record is gone', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue(null);
    assertCanMock.mockImplementation(() => { throw new ServiceError('Доступ запрещён', 403); });

    const res = await GET(statusReq());

    expect(res.status).toBe(403);
    expect(getPdfJobStatusMock).not.toHaveBeenCalled();
  });

  it('rejects (403) an OPERATOR on download when the job record is gone', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue(null);
    assertCanMock.mockImplementation(() => { throw new ServiceError('Доступ запрещён', 403); });

    const res = await GET(downloadReq());

    expect(assertCanMock).toHaveBeenCalledWith(OPERATOR, 'reports.read_cross_user');
    expect(res.status).toBe(403);
    expect(downloadPdfMock).not.toHaveBeenCalled();
  });

  it('lets a reports.read_cross_user role (DISPATCHER) download when the job record is gone', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue(null);
    requireAuthMock.mockResolvedValue({ user: DISPATCHER, error: null });
    downloadPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4'));

    const res = await GET(downloadReq());

    expect(assertCanMock).toHaveBeenCalledWith(DISPATCHER, 'reports.read_cross_user');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(downloadPdfMock).toHaveBeenCalledWith(JOB_ID);
  });

  it('still checks ownership normally when the job record exists', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue('owner-1');

    const res = await GET(statusReq());

    expect(assertCanAccessReportOwnerMock).toHaveBeenCalledWith(OPERATOR, 'owner-1', 'reports.read_cross_user');
    expect(assertCanMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('does not leak the internal error message on job status failure', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue(null);
    getPdfJobStatusMock.mockRejectedValue(new Error('Redis connection refused at 10.0.0.5:6379'));

    const res = await GET(statusReq());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toHaveProperty('message');
    expect(JSON.stringify(body)).not.toContain('redis');
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });

  it('does not leak the internal error message on job download failure', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue(null);
    downloadPdfMock.mockRejectedValue(new Error('No such key: pdfs/11111111-1111-1111-1111-111111111111.pdf'));

    const res = await GET(downloadReq());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toHaveProperty('message');
    expect(JSON.stringify(body)).not.toContain('pdfs/');
    expect(JSON.stringify(body)).not.toContain('11111111-1111-1111-1111-111111111111');
  });
});

describe('POST /api/reports/single-pdf — body validation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: OPERATOR, error: null });
  });

  it('rejects a non-string reportId with 400 and details', async () => {
    const res = await POST(postReq({ reportId: { evil: true } }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Некорректные параметры запроса');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('rejects an over-long reportId with 400', async () => {
    const res = await POST(postReq({ reportId: 'r-'.repeat(60) }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Некорректные параметры запроса');
  });

  it('keeps the original message when reportId is absent', async () => {
    const res = await POST(postReq({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Не указан reportId');
  });

  it('does not leak a non-ServiceError (Prisma) message into the feedback feed', async () => {
    vi.mocked(loadSingleReportPdfContext).mockResolvedValue({
      report: { date: '2026-01-01', siteId: 'site-1', tenantId: 'tenant-a', userId: 'user-1' },
      pdfData: {},
    } as never);
    vi.mocked(enqueuePdfGeneration).mockRejectedValue(
      new Error('Invalid `prisma.report.findUnique()` invocation: relation "Report" does not exist')
    );

    const res = await POST(postReq({ reportId: 'report-1' }));

    expect(res.status).toBe(500);
    const feedbackMessage = vi.mocked(recordFeedbackEvent).mock.calls[0][0].message;
    expect(feedbackMessage).toBe('Не удалось сформировать PDF — попробуйте ещё раз или сообщите администратору');
    expect(feedbackMessage).not.toContain('prisma');
  });
});

describe('GET /api/reports/single-pdf — лимит на синхронную генерацию по пользователю', () => {
  // Мини-замена лимитера: считает вызовы по ключу и берёт порог из конфига,
  // который передал маршрут, — так проверяется именно заданный порог
  // (20 за 5 минут), а не заглушка.
  const windows = new Map<string, number>();

  function syncReq(): NextRequest {
    return new NextRequest('http://localhost/api/reports/single-pdf?reportId=report-1');
  }

  beforeEach(() => {
    vi.resetAllMocks();
    windows.clear();
    requireAuthMock.mockResolvedValue({ user: OPERATOR, error: null });
    vi.mocked(loadSingleReportPdfContext).mockResolvedValue({
      report: { date: '2026-09-01', siteId: 'site-1', tenantId: 'tenant-a', userId: 'user-1' },
      pdfData: {},
    } as never);
    vi.mocked(generateSinglePdf).mockResolvedValue(Buffer.from('%PDF-1.4'));
    rateLimiterCheckMock.mockImplementation(
      async (key: string, config: { maxAttempts: number }) => {
        const used = (windows.get(key) ?? 0) + 1;
        windows.set(key, used);
        return used > config.maxAttempts
          ? { allowed: false, remaining: 0, retryAfter: 300 }
          : { allowed: true, remaining: config.maxAttempts - used };
      }
    );
  });

  it('ключ — по пользователю, лимит 20 за 5 минут', async () => {
    await GET(syncReq());

    expect(rateLimiterCheckMock).toHaveBeenCalledWith('pdf:get:user-1', {
      maxAttempts: 20,
      windowMs: 5 * 60 * 1000,
      blockDurationMs: 5 * 60 * 1000,
    });
  });

  it('обычный темп — PDF отдаётся как раньше', async () => {
    const res = await GET(syncReq());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(generateSinglePdf).toHaveBeenCalledTimes(1);
  });

  it('21-й запрос за окно — 429 без генерации', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await GET(syncReq())).status).toBe(200);
    }

    const res = await GET(syncReq());

    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Слишком много выгрузок подряд. Подождите пару минут.');
    expect(res.headers.get('retry-after')).toBe('300');
    expect(generateSinglePdf).toHaveBeenCalledTimes(20);
  });
});

describe('GET /api/reports/single-pdf — лимит на опрос задачи по jobId', () => {
  // Тот же приём, что и для синхронной генерации: лимитер считает вызовы по
  // ключу и берёт порог из конфига маршрута, поэтому проверяется заданный
  // лимит, а не заглушка.
  const windows = new Map<string, number>();

  beforeEach(() => {
    vi.resetAllMocks();
    windows.clear();
    requireAuthMock.mockResolvedValue({ user: OPERATOR, error: null });
    getPdfJobOwnerIdMock.mockResolvedValue(null);
    getPdfJobStatusMock.mockResolvedValue({ status: 'processing' });
    rateLimiterCheckMock.mockImplementation(
      async (key: string, config: { maxAttempts: number }) => {
        const used = (windows.get(key) ?? 0) + 1;
        windows.set(key, used);
        return used > config.maxAttempts
          ? { allowed: false, remaining: 0, retryAfter: 60 }
          : { allowed: true, remaining: config.maxAttempts - used };
      }
    );
  });

  it('ключ — по пользователю, отдельный от синхронной генерации', async () => {
    await GET(statusReq());

    expect(rateLimiterCheckMock).toHaveBeenCalledWith('pdf:job:user-1', {
      maxAttempts: 60,
      windowMs: 60 * 1000,
      blockDurationMs: 60 * 1000,
    });
  });

  it('обычный темп опроса — статус отдаётся как раньше', async () => {
    const res = await GET(statusReq());

    expect(res.status).toBe(200);
    expect(getPdfJobStatusMock).toHaveBeenCalledTimes(1);
  });

  it('исчерпанный лимит — 429 без обращения к очереди', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await GET(statusReq())).status).toBe(200);
    }
    getPdfJobStatusMock.mockClear();

    const res = await GET(statusReq());

    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Слишком много запросов к задаче. Подождите минуту.');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(getPdfJobStatusMock).not.toHaveBeenCalled();
  });
});
