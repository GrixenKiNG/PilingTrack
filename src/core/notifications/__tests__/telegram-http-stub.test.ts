// @vitest-environment node
/**
 * TelegramNotifier на настоящем HTTP — заглушка вместо api.telegram.org.
 *
 * Остальные тесты этого модуля подменяют fetch и проверяют логику. Здесь fetch
 * настоящий: запрос уходит на локальный сервер через TELEGRAM_API_BASE (та же
 * переменная, что у прокси на VPS). Так проверяется то, что fetch-мок не видит:
 * адрес, токен в пути, тело запроса и разбор ответа Telegram.
 * Настоящий Telegram не вызывается.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { findManyMock, updateManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { telegramConfig: { findMany: findManyMock, updateMany: updateManyMock } },
}));

vi.mock('@/core/security/encryption', () => ({
  decrypt: vi.fn(),
  isEncrypted: () => false,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { telegramNotifier } from '../telegram';

interface StubRequest { method: string; path: string; body: string }

describe('telegramNotifier — заглушка Telegram по HTTP', () => {
  let server: http.Server;
  let baseUrl: string;
  let requests: StubRequest[];
  let replyStatus: number;
  let replyBody: unknown;
  const originalBase = process.env.TELEGRAM_API_BASE;
  const originalTenant = process.env.DEFAULT_TENANT_ID;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method ?? '', path: req.url ?? '', body });
        res.writeHead(replyStatus, { 'content-type': 'application/json' });
        res.end(JSON.stringify(replyBody));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (originalBase === undefined) delete process.env.TELEGRAM_API_BASE;
    else process.env.TELEGRAM_API_BASE = originalBase;
    if (originalTenant === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalTenant;
  });

  beforeEach(() => {
    requests = [];
    replyStatus = 200;
    replyBody = { ok: true, result: { message_id: 1 } };
    process.env.TELEGRAM_API_BASE = baseUrl;
    process.env.DEFAULT_TENANT_ID = 'test-tenant';
    findManyMock.mockReset().mockResolvedValue([
      { id: 'cfg-1', botToken: '999:stub-token', chatId: '-100500', enabled: true },
    ]);
    updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('отправляет алерт на адрес заглушки с токеном в пути и текстом в теле', async () => {
    const ok = await telegramNotifier.sendMessage('Тестовый алерт');

    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].path).toBe('/bot999:stub-token/sendMessage');
    const sent = JSON.parse(requests[0].body) as { chat_id: string; text: string };
    expect(sent.chat_id).toBe('-100500');
    expect(sent.text).toContain('Тестовый алерт');
  });

  it('отказ Telegram не считается доставкой и не валит процесс', async () => {
    replyStatus = 403;
    replyBody = { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };

    const ok = await telegramNotifier.sendMessage('Тестовый алерт');

    expect(ok).toBe(false);
    expect(requests).toHaveLength(1);
  });
});
