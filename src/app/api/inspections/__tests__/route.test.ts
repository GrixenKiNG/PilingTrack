/**
 * /api/inspections GET + POST — behavioural tests.
 *
 * GET lists inspections (maintenance.manage); POST starts one, auto-detecting
 * block-composed (level) vs legacy (templateId) start and mapping ServiceError
 * to its HTTP status. Pins the auth boundary, the schema branch, and delegation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/services/service-error';

const { requireAuthMock, listMock, startMock, startToMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  listMock: vi.fn(),
  startMock: vi.fn(),
  startToMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/inspections', () => ({
  listInspections: listMock,
  startInspection: startMock,
  startToInspection: startToMock,
}));

import { GET, POST } from '../route';

function get(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/inspections${qs ? `?${qs}` : ''}`);
}
function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/inspections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const admin = { user: { id: 'a', role: 'ADMIN', tenantId: 'orion' }, error: null };

describe('GET /api/inspections', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    listMock.mockReset();
  });

  it('returns 403 for an OPERATOR', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    expect((await GET(get())).status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('lists tenant inspections for a maintainer (no operator scoping)', async () => {
    requireAuthMock.mockResolvedValue(admin);
    listMock.mockResolvedValue([{ id: 'i1' }]);

    const res = await GET(get('equipmentId=e1&level=TO1'));
    expect(res.status).toBe(200);
    expect((await res.json()).inspections).toEqual([{ id: 'i1' }]);
    expect(listMock).toHaveBeenCalledWith('orion', { equipmentId: 'e1', level: 'TO1' }, null);
  });
});

describe('POST /api/inspections', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    startMock.mockReset();
    startToMock.mockReset();
  });

  it('returns 403 for an OPERATOR', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    expect((await POST(post({ equipmentId: 'e1', templateId: 't1', inspectionDate: '2026-04-05' }))).status).toBe(403);
  });

  it('returns 400 when neither templateId nor a valid level is provided', async () => {
    requireAuthMock.mockResolvedValue(admin);
    expect((await POST(post({ equipmentId: 'e1' }))).status).toBe(400);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('starts a legacy inspection (templateId) → 201', async () => {
    requireAuthMock.mockResolvedValue(admin);
    startMock.mockResolvedValue({ id: 'insp-1' });

    const res = await POST(post({ equipmentId: 'e1', templateId: 't1', inspectionDate: '2026-04-05' }));
    expect(res.status).toBe(201);
    expect((await res.json()).inspection).toEqual({ id: 'insp-1' });
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1' }), { tenantId: 'orion', userId: 'a' });
    expect(startToMock).not.toHaveBeenCalled();
  });

  it('starts a block-composed ТО inspection (level) → 201', async () => {
    requireAuthMock.mockResolvedValue(admin);
    startToMock.mockResolvedValue({ id: 'to-1' });

    const res = await POST(post({ equipmentId: 'e1', level: 'TO1', inspectionDate: '2026-04-05' }));
    expect(res.status).toBe(201);
    expect((await res.json()).inspection).toEqual({ id: 'to-1' });
    expect(startToMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'TO1' }), { tenantId: 'orion', userId: 'a' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('maps a domain ServiceError to its HTTP status', async () => {
    requireAuthMock.mockResolvedValue(admin);
    startMock.mockRejectedValue(new ServiceError('Equipment busy', 409));

    const res = await POST(post({ equipmentId: 'e1', templateId: 't1', inspectionDate: '2026-04-05' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Equipment busy');
  });
});
