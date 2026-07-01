/**
 * telegram-config-service tests.
 *
 * The Telegram bot-token is the only field in this service that lives
 * encrypted at rest. If encryption gets bypassed on write or skipped on
 * read, either secrets leak in DB exports or notifications break.
 *
 * Also pins the tenant-scoping fix: TelegramConfig previously had no
 * tenantId column at all — list/create/update/delete operated globally, so
 * an ADMIN could read (and the API decrypts!) another tenant's bot token,
 * or delete/rename their config. Every entry point now requires a tenantId
 * and update/delete verify ownership (findFirst) before touching a row.
 *
 * Pins:
 *   - every function fails closed (ServiceError 400) on a missing tenantId
 *   - list/create scope by tenantId
 *   - update/delete verify the row belongs to the caller's tenant before acting
 *   - create + update encrypt the token before persisting
 *   - list decrypts on read (and tolerates legacy unencrypted rows)
 *   - validation errors are ServiceError(400)
 *   - missing IDs / records produce ServiceError(404), not raw Prisma
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  isEncrypted: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    telegramConfig: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.del,
    },
  },
}));

vi.mock('@/core/security/encryption', () => ({
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
  isEncrypted: mocks.isEncrypted,
}));

import {
  listTelegramConfigs,
  createTelegramConfig,
  updateTelegramConfig,
  deleteTelegramConfig,
} from '../telegram-config-service';
import { ServiceError } from '@/services/service-error';

const TENANT_A = 'tenant-a';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encrypt.mockImplementation((s: string) => `enc:v1:${Buffer.from(s).toString('base64')}`);
  mocks.decrypt.mockImplementation((s: string) =>
    Buffer.from(s.replace(/^enc:(v\d+:)?/, ''), 'base64').toString(),
  );
  mocks.isEncrypted.mockImplementation((s: string) => s.startsWith('enc:'));
  mocks.findFirst.mockResolvedValue({ id: 'cfg-1' }); // default: row exists in caller's tenant
});

// ============================================================
// listTelegramConfigs
// ============================================================

describe('listTelegramConfigs', () => {
  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(listTelegramConfigs('')).rejects.toBeInstanceOf(ServiceError);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('scopes the query by tenantId', async () => {
    mocks.findMany.mockResolvedValue([]);
    await listTelegramConfigs(TENANT_A);
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT_A }, orderBy: { createdAt: 'desc' } });
  });

  it('decrypts botToken on encrypted rows', async () => {
    const enc = `enc:v1:${Buffer.from('123:secret').toString('base64')}`;
    mocks.findMany.mockResolvedValue([
      { id: '1', label: 'Main', botToken: enc, chatId: '-100' },
    ]);

    const result = await listTelegramConfigs(TENANT_A);

    expect(result[0].botToken).toBe('123:secret');
    expect(mocks.decrypt).toHaveBeenCalledWith(enc);
  });

  it('passes through plain (legacy unencrypted) tokens unchanged', async () => {
    // Pre-encryption rows survive a migration; we don't mangle them.
    mocks.findMany.mockResolvedValue([
      { id: '1', label: 'Legacy', botToken: 'plain-token-456', chatId: '-100' },
    ]);

    const result = await listTelegramConfigs(TENANT_A);

    expect(result[0].botToken).toBe('plain-token-456');
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});

// ============================================================
// createTelegramConfig
// ============================================================

describe('createTelegramConfig', () => {
  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(
      createTelegramConfig('', { label: 'L', botToken: 'T', chatId: 'C' }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('stamps the new row with the caller tenantId', async () => {
    mocks.create.mockResolvedValue({ id: '1' });
    await createTelegramConfig(TENANT_A, { label: 'L', botToken: 'T', chatId: 'C' });
    expect(mocks.create.mock.calls[0][0].data.tenantId).toBe(TENANT_A);
  });

  it('encrypts the botToken BEFORE writing to DB (secrets never land plain)', async () => {
    mocks.create.mockResolvedValue({ id: '1' });

    await createTelegramConfig(TENANT_A, {
      label: 'Main',
      botToken: '123:plain-secret',
      chatId: '-100',
    });

    expect(mocks.encrypt).toHaveBeenCalledWith('123:plain-secret');
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT_A,
        label: 'Main',
        chatId: '-100',
        botToken: expect.stringMatching(/^enc:v1:/),
        enabled: true,
      }),
    });
    // Critical: the create payload's botToken is NOT the raw value.
    expect(mocks.create.mock.calls[0][0].data.botToken).not.toBe('123:plain-secret');
  });

  it('trims whitespace on text fields', async () => {
    mocks.create.mockResolvedValue({ id: '1' });

    await createTelegramConfig(TENANT_A, {
      label: '  Main  ',
      botToken: ' 123:tok ',
      chatId: '  -100  ',
    });

    expect(mocks.create.mock.calls[0][0].data.label).toBe('Main');
    expect(mocks.create.mock.calls[0][0].data.chatId).toBe('-100');
    expect(mocks.encrypt).toHaveBeenCalledWith('123:tok');
  });

  it.each([
    ['label', { botToken: 't', chatId: 'c' }],
    ['botToken', { label: 'L', chatId: 'c' }],
    ['chatId', { label: 'L', botToken: 't' }],
  ])('throws ServiceError(400) when %s is missing', async (_field, input) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    await expect(createTelegramConfig(TENANT_A, input as any)).rejects.toBeInstanceOf(ServiceError);
  });

  it('throws ServiceError(400) when a required field is empty/whitespace', async () => {
    await expect(
      createTelegramConfig(TENANT_A, { label: '   ', botToken: 'x', chatId: 'y' }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('defaults enabled=true when not specified', async () => {
    mocks.create.mockResolvedValue({ id: '1' });
    await createTelegramConfig(TENANT_A, { label: 'L', botToken: 'T', chatId: 'C' });
    expect(mocks.create.mock.calls[0][0].data.enabled).toBe(true);
  });

  it('respects enabled=false explicitly', async () => {
    mocks.create.mockResolvedValue({ id: '1' });
    await createTelegramConfig(TENANT_A, { label: 'L', botToken: 'T', chatId: 'C', enabled: false });
    expect(mocks.create.mock.calls[0][0].data.enabled).toBe(false);
  });
});

// ============================================================
// updateTelegramConfig
// ============================================================

describe('updateTelegramConfig', () => {
  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(updateTelegramConfig('', 'cfg-1', { label: 'X' })).rejects.toBeInstanceOf(ServiceError);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('throws ServiceError(400) when id is empty', async () => {
    await expect(updateTelegramConfig(TENANT_A, '', { label: 'X' })).rejects.toBeInstanceOf(ServiceError);
  });

  it('scopes the ownership check by tenantId, not id alone', async () => {
    mocks.update.mockResolvedValue({ id: 'cfg-1' });
    await updateTelegramConfig(TENANT_A, 'cfg-1', { label: 'Renamed' });
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cfg-1', tenantId: TENANT_A } }),
    );
  });

  it("returns 404 (not another tenant's config) when the row belongs to a different tenant", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(
      updateTelegramConfig(TENANT_A, 'cfg-owned-by-tenant-b', { label: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('encrypts a new botToken before writing', async () => {
    mocks.update.mockResolvedValue({ id: 'cfg-1' });

    await updateTelegramConfig(TENANT_A, 'cfg-1', { botToken: 'rotated-secret' });

    expect(mocks.encrypt).toHaveBeenCalledWith('rotated-secret');
    expect(mocks.update.mock.calls[0][0].data.botToken).toMatch(/^enc:v1:/);
  });

  it('does NOT touch botToken if it is not in the input (avoids accidental rotation)', async () => {
    mocks.update.mockResolvedValue({ id: 'cfg-1' });

    await updateTelegramConfig(TENANT_A, 'cfg-1', { label: 'Renamed' });

    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('botToken');
  });

  it('translates Prisma "not found" into ServiceError(404) on a delete-time race', async () => {
    mocks.update.mockRejectedValue(new Error('Record to update not found.'));
    await expect(
      updateTelegramConfig(TENANT_A, 'cfg-1', { label: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lets unrelated Prisma errors bubble up unchanged', async () => {
    mocks.update.mockRejectedValue(new Error('connection refused'));
    await expect(
      updateTelegramConfig(TENANT_A, 'cfg-1', { label: 'X' }),
    ).rejects.toThrow('connection refused');
  });
});

// ============================================================
// deleteTelegramConfig
// ============================================================

describe('deleteTelegramConfig', () => {
  it('rejects when tenantId is missing (fail-closed)', async () => {
    await expect(deleteTelegramConfig('', 'cfg-1')).rejects.toBeInstanceOf(ServiceError);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('throws ServiceError(400) when id is empty', async () => {
    await expect(deleteTelegramConfig(TENANT_A, '')).rejects.toBeInstanceOf(ServiceError);
  });

  it('scopes the ownership check by tenantId before an irreversible delete', async () => {
    mocks.del.mockResolvedValue({});
    await deleteTelegramConfig(TENANT_A, 'cfg-1');
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cfg-1', tenantId: TENANT_A } }),
    );
  });

  it("returns 404 (not another tenant's config) when the row belongs to a different tenant", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(deleteTelegramConfig(TENANT_A, 'cfg-owned-by-tenant-b')).rejects.toMatchObject({ status: 404 });
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('returns { success: true } on happy path', async () => {
    mocks.del.mockResolvedValue({});
    expect(await deleteTelegramConfig(TENANT_A, 'cfg-1')).toEqual({ success: true });
  });

  it('translates a delete-time race into ServiceError(404)', async () => {
    mocks.del.mockRejectedValue(new Error('Record to delete not found.'));
    await expect(deleteTelegramConfig(TENANT_A, 'cfg-x')).rejects.toMatchObject({ status: 404 });
  });
});
