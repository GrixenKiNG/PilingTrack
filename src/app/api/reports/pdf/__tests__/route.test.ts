/**
 * POST /api/reports/pdf — the queued (default) path must carry the tenant id,
 * otherwise the worker builds the period PDF without the organisation name
 * while the synchronous path prints it (audit 44, finding №4).
 *
 * GET /api/reports/pdf — sync generation must be rate limited per user
 * (audit R67, F-PDF-GET-LIMIT): a top-level navigation from a foreign site
 * carries the SameSite=Lax session cookie and fires the heavy synchronous
 * render in the victim's browser session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock, assertCanMock, buildPeriodPdfDataMock, enqueuePdfGenerationMock,
  generatePeriodPdfMock, getPdfJobStatusMock, downloadPdfMock, rateLimiterCheckMock, pdfJobFromIdMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  buildPeriodPdfDataMock: vi.fn(),
  enqueuePdfGenerationMock: vi.fn(),
  generatePeriodPdfMock: vi.fn(),
  getPdfJobStatusMock: vi.fn(),
  downloadPdfMock: vi.fn(),
  pdfJobFromIdMock: vi.fn(),
  // По умолчанию запрос разрешён: POST/статус-ветки ходят в тот же лимитер.
  rateLimiterCheckMock: vi.fn(async (_key: string, _config: { maxAttempts: number }) => ({
    allowed: true,
    remaining: 20,
  })),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: assertCanMock }));
vi.mock('@/lib/pdf-data', () => ({ buildPeriodPdfData: buildPeriodPdfDataMock }));
vi.mock('@/lib/pdf-queue', () => ({
  enqueuePdfGeneration: enqueuePdfGenerationMock,
  getPdfJobStatus: getPdfJobStatusMock,
  downloadPdf: downloadPdfMock,
}));
vi.mock('@/lib/pdf-generator', () => ({ generatePeriodPdf: generatePeriodPdfMock }));
vi.mock('bullmq', () => ({
  Queue: class {}, QueueEvents: class {}, Job: { fromId: pdfJobFromIdMock },
}));
vi.mock('ioredis', () => ({ Redis: class { on() { return this; } } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/services/feedback/feedback-event-service', () => ({ recordFeedbackEvent: vi.fn() }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: rateLimiterCheckMock },
  getRateLimitIdentifier: () => 'test-ip',
}));

import { GET, POST } from '../route';

const ADMIN = { id: 'user-1', name: 'Мастер', role: 'ADMIN', tenantId: 'tenant-a' };

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reports/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reports/pdf — tenant id reaches the queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    buildPeriodPdfDataMock.mockResolvedValue({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      siteId: '',
      reports: [],
      totalPiles: 3,
      totalDrilling: 24,
      totalDowntime: 75,
      companyName: 'ООО «ОРИОН-Строй»',
    });
  });

  it('enqueues the job with the caller tenant so the worker can load the company name', async () => {
    enqueuePdfGenerationMock.mockResolvedValue('job-1');

    const res = await POST(postReq({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }));

    expect(res.status).toBe(202);
    expect(enqueuePdfGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'period',
        tenantId: 'tenant-a',
        totalPiles: 3,
        totalDrilling: 24,
        totalDowntime: 75,
      })
    );
  });

  it('enqueues a null tenant when the session has none', async () => {
    requireAuthMock.mockResolvedValue({ user: { ...ADMIN, tenantId: null }, error: null });
    enqueuePdfGenerationMock.mockResolvedValue('job-2');

    const res = await POST(postReq({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }));

    expect(res.status).toBe(202);
    expect(enqueuePdfGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null })
    );
  });
});

describe('GET /api/reports/pdf — лимит на синхронную генерацию по пользователю', () => {
  // Мини-замена лимитера: считает вызовы по ключу и берёт порог из конфига,
  // который передал маршрут, — так проверяется именно заданный порог
  // (20 за 5 минут), а не заглушка.
  const windows = new Map<string, number>();

  function syncReq(): NextRequest {
    return new NextRequest('http://localhost/api/reports/pdf?dateFrom=2026-09-01&dateTo=2026-09-30');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    windows.clear();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    buildPeriodPdfDataMock.mockResolvedValue({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      siteId: '',
      reports: [],
      totalPiles: 3,
      totalDrilling: 24,
      totalDowntime: 75,
      companyName: 'ООО «ОРИОН-Строй»',
    });
    generatePeriodPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4'));
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
    expect(generatePeriodPdfMock).toHaveBeenCalledTimes(1);
  });

  it('21-й запрос за окно — 429 без генерации', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await GET(syncReq())).status).toBe(200);
    }

    const res = await GET(syncReq());

    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Слишком много выгрузок подряд. Подождите пару минут.');
    expect(res.headers.get('retry-after')).toBe('300');
    expect(generatePeriodPdfMock).toHaveBeenCalledTimes(20);
  });
});

describe('GET /api/reports/pdf — общий лимит статуса и скачивания задачи', () => {
  const windows = new Map<string, number>();
  const jobIds = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  function jobReq(action: string, jobId = jobIds[0]): NextRequest {
    return new NextRequest(`http://localhost/api/reports/pdf?jobId=${jobId}&action=${action}`);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    windows.clear();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    getPdfJobStatusMock.mockResolvedValue({ status: 'completed' });
    downloadPdfMock.mockResolvedValue(Buffer.from('%PDF-1.4'));
    rateLimiterCheckMock.mockImplementation(async (key: string, config: { maxAttempts: number }) => {
      const used = (windows.get(key) ?? 0) + 1;
      windows.set(key, used);
      return used > config.maxAttempts
        ? { allowed: false, remaining: 0, retryAfter: 60 }
        : { allowed: true, remaining: config.maxAttempts - used };
    });
  });

  it.each(['status', 'download'])('429 для %s возвращается до чтения очереди и файла', async (action) => {
    rateLimiterCheckMock.mockImplementation(async () => ({ allowed: false, remaining: 0, retryAfter: 37 }));
    const res = await GET(jobReq(action));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('37');
    expect(getPdfJobStatusMock).not.toHaveBeenCalled();
    expect(downloadPdfMock).not.toHaveBeenCalled();
  });

  it('61-й запрос блокируется, даже если менять действие и UUID задачи', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await GET(jobReq(i % 2 ? 'download' : 'status', jobIds[i % 2]))).status).toBe(200);
    }
    expect((await GET(jobReq('status', jobIds[1]))).status).toBe(429);
    expect(getPdfJobStatusMock).toHaveBeenCalledTimes(30);
    expect(downloadPdfMock).toHaveBeenCalledTimes(30);
    expect(rateLimiterCheckMock).toHaveBeenCalledWith('pdf:job:user-1', {
      maxAttempts: 60, windowMs: 60 * 1000, blockDurationMs: 60 * 1000,
    });
  });

  it('исчерпание бюджета одного пользователя не ограничивает другого', async () => {
    for (let i = 0; i < 60; i++) await GET(jobReq('status'));
    requireAuthMock.mockResolvedValue({ user: { ...ADMIN, id: 'user-2' }, error: null });
    expect((await GET(jobReq('download'))).status).toBe(200);
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    expect((await GET(jobReq('download'))).status).toBe(429);
    expect(downloadPdfMock).toHaveBeenCalledTimes(1);
  });
});

describe('GET PDF download — реальное состояние очереди без Redis', () => {
  it.each([['failed', 500], ['waiting', 202], ['active', 202]])(
    'задача %s возвращает HTTP %i', async (state, expectedStatus) => {
      vi.clearAllMocks();
      requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
      rateLimiterCheckMock.mockImplementation(async () => ({ allowed: true, remaining: 59 }));
      pdfJobFromIdMock.mockResolvedValue({ getState: async () => state, failedReason: 'internal worker error' });
      const queue = await vi.importActual<typeof import('@/lib/pdf-queue')>('@/lib/pdf-queue');
      downloadPdfMock.mockImplementation(queue.downloadPdf);
      const res = await GET(new NextRequest(
        'http://localhost/api/reports/pdf?jobId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&action=download',
      ));
      expect(res.status).toBe(expectedStatus);
      expect(JSON.stringify(await res.json())).not.toContain('internal worker error');
    },
  );
});
