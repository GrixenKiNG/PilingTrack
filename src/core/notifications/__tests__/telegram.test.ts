/**
 * TelegramNotifier — token decryption regression test.
 *
 * Bug we're guarding (2026-04): getConfig() returned the raw `enc:...`
 * ciphertext as the bot token, so all Telegram API calls hit
 *   https://api.telegram.org/botenc:.../...
 * and silently failed. Fix decrypts the token via @/core/security/encryption.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { findManyMock, decryptMock, isEncryptedMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  decryptMock: vi.fn(),
  isEncryptedMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { telegramConfig: { findMany: findManyMock } },
}));

vi.mock('@/core/security/encryption', () => ({
  decrypt: decryptMock,
  isEncrypted: isEncryptedMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { telegramNotifier } from '../telegram';

describe('telegramNotifier — botToken decryption', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  beforeEach(() => {
    findManyMock.mockReset();
    decryptMock.mockReset();
    isEncryptedMock.mockReset();
    // getConfig() has no per-request tenant (this notifier is called from
    // background paths — webhook, DLQ, alert engine), so it resolves the
    // deployment's default tenant instead.
    process.env.DEFAULT_TENANT_ID = 'test-tenant';
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { title: 'Test Chat' } }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    // Restore process.env — a mutation here would otherwise leak into other
    // test files sharing this worker (vitest does not snapshot process.env).
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  it('decrypts enc:-prefixed botToken before calling Telegram API', async () => {
    findManyMock.mockResolvedValue([
      { botToken: 'enc:CIPHERTEXT', chatId: '-100123', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(true);
    decryptMock.mockReturnValue('999:REAL-PLAINTEXT-TOKEN');

    const res = await telegramNotifier.testConnection();

    expect(res.ok).toBe(true);
    expect(res.chatTitle).toBe('Test Chat');
    expect(decryptMock).toHaveBeenCalledWith('enc:CIPHERTEXT');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('999:REAL-PLAINTEXT-TOKEN');
    expect(url).not.toContain('enc:CIPHERTEXT');
  });

  it('passes plain-text botToken through without decrypting', async () => {
    findManyMock.mockResolvedValue([
      { botToken: '999:plain-token', chatId: '-100123', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);

    const res = await telegramNotifier.testConnection();

    expect(res.ok).toBe(true);
    expect(decryptMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toContain('999:plain-token');
  });

  it('returns Not configured when no enabled config row exists', async () => {
    findManyMock.mockResolvedValue([]);
    const res = await telegramNotifier.testConnection();
    expect(res).toEqual({ ok: false, error: 'Not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scopes the config lookup by the default tenant', async () => {
    findManyMock.mockResolvedValue([
      { botToken: '999:plain-token', chatId: '-100123', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);

    await telegramNotifier.testConnection();

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true, tenantId: 'test-tenant' } }),
    );
  });

  it('fails closed (no config, no DB call) when DEFAULT_TENANT_ID is unset', async () => {
    delete process.env.DEFAULT_TENANT_ID;
    const res = await telegramNotifier.testConnection();
    expect(res).toEqual({ ok: false, error: 'Not configured' });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('builds the alert header and field labels in Russian', async () => {
    findManyMock.mockResolvedValue([
      { botToken: '999:plain-token', chatId: '-100123', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);

    await telegramNotifier.sendAlert({
      severity: 'medium',
      message: 'Простой 3 ч зафиксирован в отчёте',
      siteId: 'site-1',
      reportId: 'report-1',
      ruleId: 'downtime30',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { text: string };
    expect(body.text).toContain('⚠️ <b>Предупреждение</b>');
    expect(body.text).toContain('📍 Объект: <code>site-1</code>');
    expect(body.text).toContain('📄 Отчёт: <code>report-1</code>');
    expect(body.text).toContain('📏 Правило: <code>downtime30</code>');
    expect(body.text).not.toContain('Alert');
  });
});

describe('telegramNotifier — доставка во все конфигурации', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  beforeEach(() => {
    findManyMock.mockReset();
    decryptMock.mockReset();
    isEncryptedMock.mockReset();
    process.env.DEFAULT_TENANT_ID = 'test-tenant';
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: {} }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  function sentChatIds() {
    return fetchMock.mock.calls.map(
      (call) => JSON.parse(call[1].body as string).chat_id as string,
    );
  }

  it('шлёт алерт в каждую включённую конфигурацию, дедупликация по chatId', async () => {
    findManyMock.mockResolvedValue([
      { botToken: '999:token-a', chatId: '-100A', enabled: true },
      { botToken: '999:token-b', chatId: '-100B', enabled: true },
      { botToken: '999:token-c', chatId: '-100A', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);

    const res = await telegramNotifier.sendAlert({ severity: 'high', message: 'тревога' });

    expect(res).toBe(true);
    expect(sentChatIds()).toEqual(['-100A', '-100B']);
  });

  it('отказ по одному чату не срывает отправку в остальные', async () => {
    findManyMock.mockResolvedValue([
      { botToken: '999:token-a', chatId: '-100A', enabled: true },
      { botToken: '999:token-b', chatId: '-100B', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'bad chat' })
      .mockResolvedValueOnce({ ok: true, text: async () => '' });

    const res = await telegramNotifier.sendAlert({ severity: 'critical', message: 'тревога' });

    expect(res).toBe(true);
    expect(sentChatIds()).toEqual(['-100A', '-100B']);
  });

  it('считает доставку неуспешной, только если упали все чаты', async () => {
    findManyMock.mockResolvedValue([
      { botToken: '999:token-a', chatId: '-100A', enabled: true },
      { botToken: '999:token-b', chatId: '-100B', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    const res = await telegramNotifier.sendAlert({ severity: 'low', message: 'тревога' });

    expect(res).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
