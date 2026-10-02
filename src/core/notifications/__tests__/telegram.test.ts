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
import { createTelegramDeliveryProgress } from '../telegram-delivery-progress';
import type { Prisma } from '@/generated/postgres-client/client';

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
      json: async () => ({ ok: true, result: { title: 'Test Chat' } }),
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
      json: async () => ({ ok: true, result: {} }),
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }), text: async () => '' });

    const res = await telegramNotifier.sendAlert({ severity: 'critical', message: 'тревога' });

    expect(res).toBe(false);
    expect(sentChatIds()).toEqual(['-100A', '-100B']);
  });

  it('I08: persists a partial batch and retries only unconfirmed chats after restart', async () => {
    findManyMock.mockResolvedValue([{ botToken: 'test-a', chatId: 'A', enabled: true }, { botToken: 'test-b', chatId: 'B', enabled: true }]);
    isEncryptedMock.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockRejectedValueOnce(new Error('ambiguous timeout'));
    let payload: Prisma.JsonValue = { message: 'batch' };
    const progress = () => createTelegramDeliveryProgress(payload, async next => { payload = JSON.parse(JSON.stringify(next)); });
    expect(await telegramNotifier.sendMessage('batch', progress())).toBe(false);
    expect(payload).toEqual({ message: 'batch', telegramDeliveredChatIds: ['A'] });
    expect(sentChatIds()).toEqual(['A', 'B']);
    fetchMock.mockClear().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    // Fresh progress reconstructed from persisted JSON, no in-memory delivery cache.
    expect(await telegramNotifier.sendMessage('batch', progress())).toBe(true);
    expect(sentChatIds()).toEqual(['B']);
    expect(payload).toEqual({ message: 'batch', telegramDeliveredChatIds: ['A', 'B'] });
  });

  it('I08: HTTP success without a Telegram acknowledgement stays unconfirmed', async () => {
    findManyMock.mockResolvedValue([{ botToken: 'test-a', chatId: 'A', enabled: true }]);
    isEncryptedMock.mockReturnValue(false);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: false }) });
    const confirm = vi.fn();
    expect(await telegramNotifier.sendMessage('batch', { deliveredChatIds: new Set(), confirm })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('считает доставку неуспешной, если упали все чаты', async () => {
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

/*
  F-R33-1: в алерт уходили внутренние cuid («📍 Объект: clx…», «📄 Отчёт: …») и
  время сервера без зоны (в контейнере UTC — на 3 часа раньше московского).
  Теперь вызывающий передаёт название объекта, номер отчёта и зону
  организации; строки с id остаются фолбэком для остальных отправителей.
*/
describe('telegramNotifier — человекочитаемые поля и зона (F-R33-1)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  beforeEach(() => {
    findManyMock.mockReset();
    decryptMock.mockReset();
    isEncryptedMock.mockReset();
    process.env.DEFAULT_TENANT_ID = 'test-tenant';
    findManyMock.mockResolvedValue([
      { botToken: '999:plain-token', chatId: '-100123', enabled: true },
    ]);
    isEncryptedMock.mockReturnValue(false);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }), text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  function sentText(): string {
    return JSON.parse(fetchMock.mock.calls[0][1].body as string).text as string;
  }

  it('показывает название объекта и номер отчёта вместо cuid', async () => {
    await telegramNotifier.sendAlert({
      severity: 'medium',
      message: 'Простой 2 ч 20 мин зафиксирован в отчёте',
      siteId: 'clx1234sitecuid',
      siteName: 'Объект «Северный»',
      reportId: 'RM-abcd1234-2026-09-26',
      reportNumber: 'RM-abcd1234-2026-09-26',
    });

    const text = sentText();
    expect(text).toContain('📍 Объект: <b>Объект «Северный»</b>');
    expect(text).toContain('📄 Отчёт: <b>RM-abcd1234-2026-09-26</b>');
    expect(text).not.toContain('clx1234sitecuid');
  });

  it('экранирует HTML в названии объекта и номере отчёта', async () => {
    await telegramNotifier.sendAlert({
      severity: 'high',
      message: 'тревога',
      siteName: 'Объект <b>«Север»</b> & Co',
      reportNumber: 'RM-1 <script>',
    });

    const text = sentText();
    expect(text).toContain('📍 Объект: <b>Объект &lt;b&gt;«Север»&lt;/b&gt; &amp; Co</b>');
    expect(text).toContain('📄 Отчёт: <b>RM-1 &lt;script&gt;</b>');
    expect(text).not.toContain('<script>');
  });

  it('печатает время в зоне организации в формате ДД.ММ.ГГГГ, ЧЧ:ММ', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T21:30:00Z'));

    await telegramNotifier.sendAlert({
      severity: 'medium',
      message: 'тревога',
      timeZone: 'Europe/Moscow',
    });

    expect(sentText()).toContain('⏰ 27.09.2026, 00:30');
  });

  it('уважает зону тенанта, а не серверную', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-26T21:30:00Z'));

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }), text: async () => '' });
    await telegramNotifier.sendAlert({
      severity: 'medium',
      message: 'тревога',
      timeZone: 'Asia/Krasnoyarsk',
    });

    expect(sentText()).toContain('⏰ 27.09.2026, 04:30');
  });
});

/**
 * PDF отчёта не доходил в Telegram ни разу с 25.09.2026: обработчик шлёт его
 * изнутри `db.$transaction(async (tx) => …)` (блокировка строки события,
 * event-handlers.ts), а обёртка транзакции помечает область «тенант уже в
 * базе» (tenant-rls.ts: runWithGucApplied). Чтение настроек бота идёт
 * глобальным клиентом МИМО этой транзакции, но пометку наследовало — тенант к
 * запросу не прикладывался, строгий RLS возвращал ноль строк, и в журнале
 * было «Telegram not configured — skipping document». Сообщения об ошибках
 * идут вне транзакций и доходили.
 */
describe('telegramNotifier — чтение настроек внутри чужой транзакции', () => {
  const originalDefaultTenantId = process.env.DEFAULT_TENANT_ID;

  beforeEach(() => {
    findManyMock.mockReset();
    isEncryptedMock.mockReset().mockReturnValue(false);
    process.env.DEFAULT_TENANT_ID = 'orion';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }), text: async () => '' }));
  });

  afterEach(() => {
    if (originalDefaultTenantId === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = originalDefaultTenantId;
  });

  it('запрос настроек несёт тенанта, даже если вызван из области runWithGucApplied', async () => {
    const { runWithGucApplied, resolveGucTenantId } = await import('@/core/security/tenant-rls');
    let tenantSeenByQuery: string | null | undefined;
    findManyMock.mockImplementation(async () => {
      // Ровно то, что решает расширение Prisma: доставлять ли тенанта в базу.
      tenantSeenByQuery = resolveGucTenantId();
      return [{ botToken: 'plain-token', chatId: '-100', enabled: true }];
    });

    const sent = await runWithGucApplied(() =>
      telegramNotifier.sendDocument('r.pdf', Buffer.from('%PDF'), 'подпись'),
    );

    expect(tenantSeenByQuery).toBe('orion');
    expect(sent).toBe(true);
  });
});
