/**
 * POST /api/reports/pdf — the queued (default) path must carry the tenant id,
 * otherwise the worker builds the period PDF without the organisation name
 * while the synchronous path prints it (audit 44, finding №4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthMock, assertCanMock, buildPeriodPdfDataMock, enqueuePdfGenerationMock,
  generatePeriodPdfMock, getPdfJobStatusMock, downloadPdfMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assertCanMock: vi.fn(),
  buildPeriodPdfDataMock: vi.fn(),
  enqueuePdfGenerationMock: vi.fn(),
  generatePeriodPdfMock: vi.fn(),
  getPdfJobStatusMock: vi.fn(),
  downloadPdfMock: vi.fn(),
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
vi.mock('@/services/feedback/feedback-event-service', () => ({ recordFeedbackEvent: vi.fn() }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { POST } from '../route';

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