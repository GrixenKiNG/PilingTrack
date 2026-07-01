/**
 * DELETE /api/reports/delete — tenant scoping regression.
 *
 * Pre-existing IDOR: reportId is globally unique, so the handler deleted by
 * `db.report.delete({ where: { reportId } })` with zero tenant check — any
 * ADMIN/DISPATCHER (reports.manage_all) could delete another tenant's report.
 * Fixed to findFirst-by-tenant before the (irreversible) delete, mirroring
 * dictionary-service.ts's ownership-check-before-delete pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, findFirstMock, deleteMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findFirstMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/db', () => ({
  db: { report: { findFirst: findFirstMock, delete: deleteMock } },
}));

import { DELETE } from '../route';

const ADMIN = { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a' };

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
    findFirstMock.mockResolvedValue({ id: 'internal-1' });
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

    expect(res.status).toBe(400);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('returns 404 on a delete-time race instead of leaking a 500', async () => {
    findFirstMock.mockResolvedValue({ id: 'internal-1' });
    deleteMock.mockRejectedValue(new Error('Record to delete does not exist.'));

    const res = await DELETE(deleteReq('report-1'));

    expect(res.status).toBe(404);
  });
});
