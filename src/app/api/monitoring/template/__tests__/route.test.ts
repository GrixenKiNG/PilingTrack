import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, saveTemplateMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  saveTemplateMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/layout', async (importOriginal) => ({ ...await importOriginal<typeof import('@/modules/layout')>(), getLayoutSnapshot: vi.fn(), saveLayoutSnapshot: saveTemplateMock }));

import { LayoutConflictError } from '@/modules/layout';
import { PUT } from '../route';

const request = (body: string) => new NextRequest('http://localhost/api/monitoring/template', {
  method: 'PUT',
  body,
  headers: {
    host: 'localhost',
    origin: 'http://localhost',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  },
});

describe('PUT /api/monitoring/template', () => {
  beforeEach(() => {
    saveTemplateMock.mockReset();
    requireAuthMock.mockReset().mockResolvedValue({
      user: { id: 'admin', role: 'ADMIN', tenantId: 'tenant-1' },
      error: null,
    });
  });

  it('конфликт версии — 409, а не 503', async () => {
    saveTemplateMock.mockRejectedValue(new LayoutConflictError());
    expect((await PUT(request('{}'))).status).toBe(409);
  });

  it('ошибка проверки шаблона — 400', async () => {
    saveTemplateMock.mockRejectedValue(new TypeError('Invalid layout template'));
    expect((await PUT(request('{}'))).status).toBe(400);
  });

  it('сбой базы или кэша — 503 с Retry-After, а не «Некорректные данные»', async () => {
    saveTemplateMock.mockRejectedValue(new Error('Can\'t reach database server'));
    const response = await PUT(request('{}'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });
});
