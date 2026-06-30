/**
 * GET /api/reports/single-pdf — job ownership fail-closed regression.
 *
 * getPdfJobOwnerId returns null once BullMQ prunes a completed job record
 * (removeOnComplete count-based eviction can fire well before the rendered
 * PDF's own RESULTS_TTL expires in storage). The ownership check used to be
 * skipped entirely in that case — any authenticated user could poll/download
 * any job by guessing/observing a jobId. Must fail closed instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/lib/service-error';

const {
  requireAuthMock, getPdfJobOwnerIdMock, getPdfJobStatusMock, downloadPdfMock,
  assertCanAccessReportOwnerMock, assertCanMock,
} = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getPdfJobOwnerIdMock: vi.fn(),
  getPdfJobStatusMock: vi.fn(),
  downloadPdfMock: vi.fn(),
  assertCanAccessReportOwnerMock: vi.fn(),
  assertCanMock: vi.fn(),
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

import { GET } from '../route';

const OPERATOR = { id: 'user-1', role: 'OPERATOR', tenantId: 'tenant-a' };
const JOB_ID = '11111111-1111-1111-1111-111111111111';

function statusReq(): NextRequest {
  return new NextRequest(`http://localhost/api/reports/single-pdf?jobId=${JOB_ID}&action=status`);
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

  it('still checks ownership normally when the job record exists', async () => {
    getPdfJobOwnerIdMock.mockResolvedValue('owner-1');

    const res = await GET(statusReq());

    expect(assertCanAccessReportOwnerMock).toHaveBeenCalledWith(OPERATOR, 'owner-1', 'reports.read_cross_user');
    expect(assertCanMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});
