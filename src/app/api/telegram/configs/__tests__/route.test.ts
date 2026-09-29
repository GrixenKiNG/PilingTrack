/**
 * POST/PUT/DELETE /api/telegram/configs — behavioural tests.
 *
 * Канал решает, кто получит сообщение о дефекте или простое, поэтому заведение,
 * правка и удаление конфигурации должны оставлять след в журнале аудита
 * (находка F-R34-24). В след не попадает токен бота — ни сам, ни его хвост: он
 * даёт полный контроль над ботом, а в ленте достаточно факта его замены.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, recordAuditEventMock, svc, findFirstMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  recordAuditEventMock: vi.fn(),
  svc: {
    createTelegramConfig: vi.fn(),
    updateTelegramConfig: vi.fn(),
    deleteTelegramConfig: vi.fn(),
    listTelegramConfigs: vi.fn(),
  },
  findFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: recordAuditEventMock }));
vi.mock('@/services/telegram/telegram-config-service', () => svc);
vi.mock('@/lib/db', () => ({ db: { telegramConfig: { findFirst: findFirstMock } } }));

import { POST, PUT, DELETE } from '../route';
import { ServiceError } from '@/lib/service-error';

const admin = { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' };
const TOKEN = '123456:secret-bot-token';
const CHAT = '-1001234567890';

/** Аргумент, с которым маршрут позвал запись следа. */
let audited: Record<string, unknown> | null = null;

function req(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/telegram/configs', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// createTelegramConfig отдаёт строку без секрета, но с хвостом токена и
// признаком его наличия: если маршрут когда-нибудь положит в metadata не
// собранный снимок, а саму строку, тесты ниже это увидят.
const savedConfig = {
  id: 'cfg-1',
  label: 'Основной чат',
  chatId: CHAT,
  enabled: true,
  botTokenHint: 'oken',
  hasBotToken: true,
};

const deletedRow = { id: 'cfg-1', label: 'Основной чат', chatId: CHAT, enabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  audited = null;
  requireAuthMock.mockResolvedValue({ user: admin, error: null });
  recordAuditEventMock.mockImplementation(async (event: Record<string, unknown>) => {
    audited = event;
  });
  svc.createTelegramConfig.mockResolvedValue(savedConfig);
  svc.updateTelegramConfig.mockResolvedValue(savedConfig);
  svc.deleteTelegramConfig.mockResolvedValue({ success: true });
  findFirstMock.mockResolvedValue(deletedRow);
});

describe('POST /api/telegram/configs', () => {
  it('записывает telegram.config.created с названием и id чата', async () => {
    const response = await POST(req('POST', { label: 'Основной чат', botToken: TOKEN, chatId: CHAT }));

    expect(response.status).toBe(201);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'telegram.config.created',
      scope: 'telegram',
      actorId: 'admin-a',
      targetId: 'cfg-1',
      tenantId: 'tenant-a',
      metadata: { configId: 'cfg-1', label: 'Основной чат', chatId: CHAT, enabled: true },
    });
  });

  it('не кладёт токен бота в metadata', async () => {
    await POST(req('POST', { label: 'Основной чат', botToken: TOKEN, chatId: CHAT }));

    expect(JSON.stringify(audited)).not.toContain(TOKEN);
    expect(JSON.stringify(audited)).not.toContain('botToken');
  });

  it('отказывает без права telegram.manage и следа не оставляет', async () => {
    requireAuthMock.mockResolvedValue({ user: { ...admin, role: 'DISPATCHER' }, error: null });

    const response = await POST(req('POST', { label: 'Основной чат', botToken: TOKEN, chatId: CHAT }));

    expect(response.status).toBe(403);
    expect(svc.createTelegramConfig).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('не пишет след на отклонённые данные', async () => {
    const response = await POST(req('POST', { label: '', botToken: TOKEN, chatId: CHAT }));

    expect(response.status).toBe(400);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});

describe('PUT /api/telegram/configs', () => {
  it('записывает telegram.config.updated с названием и id чата', async () => {
    svc.updateTelegramConfig.mockResolvedValue({ ...savedConfig, enabled: false });

    const response = await PUT(req('PUT', { id: 'cfg-1', enabled: false }));

    expect(response.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'telegram.config.updated',
      scope: 'telegram',
      actorId: 'admin-a',
      targetId: 'cfg-1',
      tenantId: 'tenant-a',
      metadata: { configId: 'cfg-1', label: 'Основной чат', chatId: CHAT, enabled: false, tokenUpdated: false },
    });
  });

  it('отмечает замену токена, не показывая его', async () => {
    await PUT(req('PUT', { id: 'cfg-1', botToken: TOKEN, chatId: CHAT }));

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ tokenUpdated: true, chatId: CHAT }),
      }),
    );
    expect(JSON.stringify(audited)).not.toContain(TOKEN);
    expect(JSON.stringify(audited)).not.toContain('botToken');
  });

  it('правку без токена не выдаёт за ротацию секрета', async () => {
    await PUT(req('PUT', { id: 'cfg-1', label: 'Дежурный' }));

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ tokenUpdated: false }) }),
    );
  });
});

describe('DELETE /api/telegram/configs', () => {
  it('читает строку до удаления и пишет telegram.config.deleted по её данным', async () => {
    const response = await DELETE(req('DELETE', { id: 'cfg-1' }));

    expect(response.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'cfg-1', tenantId: 'tenant-a' },
      select: { id: true, label: true, chatId: true, enabled: true },
    });
    expect(findFirstMock.mock.invocationCallOrder[0]).toBeLessThan(
      svc.deleteTelegramConfig.mock.invocationCallOrder[0],
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith({
      action: 'telegram.config.deleted',
      scope: 'telegram',
      actorId: 'admin-a',
      targetId: 'cfg-1',
      tenantId: 'tenant-a',
      metadata: { configId: 'cfg-1', label: 'Основной чат', chatId: CHAT, enabled: true },
    });
    expect(JSON.stringify(audited)).not.toContain('botToken');
  });

  it('не пишет след, если строка чужой организации и удаление отказано', async () => {
    findFirstMock.mockResolvedValue(null);
    svc.deleteTelegramConfig.mockRejectedValue(new ServiceError('Config not found', 404));

    const response = await DELETE(req('DELETE', { id: 'cfg-owned-by-tenant-b' }));

    expect(response.status).toBe(404);
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
