/**
 * TelegramNotifier — token decryption regression test.
 *
 * Bug we're guarding (2026-04): getConfig() returned the raw `enc:...`
 * ciphertext as the bot token, so all Telegram API calls hit
 *   https://api.telegram.org/botenc:.../...
 * and silently failed. Fix decrypts the token via @/core/security/encryption.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  beforeEach(() => {
    findManyMock.mockReset();
    decryptMock.mockReset();
    isEncryptedMock.mockReset();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { title: 'Test Chat' } }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
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
});
