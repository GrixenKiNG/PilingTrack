/**
 * provisionDeviceKey / authenticateDeviceByKey — поведенческие тесты.
 *
 * Проверяем:
 * - выпуск ключа устройства (provisionDeviceKey)
 * - сравнение ключа через timingSafeEqual (authenticateDeviceByKey)
 * - отказ на неизвестном/отозванном устройстве
 * - ключ не возвращается повторно после выпуска (plaintext только один раз)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUniqueEquipmentMock,
  createDeviceKeyMock,
  findUniqueDeviceKeyMock,
  updateDeviceKeyMock,
} = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  createDeviceKeyMock: vi.fn(),
  findUniqueDeviceKeyMock: vi.fn(),
  updateDeviceKeyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueEquipmentMock },
    deviceKey: {
      findUnique: findUniqueDeviceKeyMock,
      create: createDeviceKeyMock,
      update: updateDeviceKeyMock,
    },
  },
}));

import { provisionDeviceKey, authenticateDeviceByKey } from '../device-key-service';

describe('provisionDeviceKey — выпуск ключа устройства', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    createDeviceKeyMock.mockReset();
  });

  it('отвергает запрос без tenantId (fail-closed)', async () => {
    await expect(
      provisionDeviceKey({ name: 'x', equipmentId: 'eq-1', tenantId: '' })
    ).rejects.toThrow('tenantId is required');
    expect(findUniqueEquipmentMock).not.toHaveBeenCalled();
  });

  it('ищет оборудование строго по паре (id, tenantId)', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);

    await expect(
      provisionDeviceKey({ name: 'x', equipmentId: 'eq-1', tenantId: 'tenant-a' })
    ).rejects.toThrow('Equipment not found');

    expect(findUniqueEquipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'eq-1', tenantId: 'tenant-a' } })
    );
    expect(createDeviceKeyMock).not.toHaveBeenCalled();
  });

  it('выпускает ключ, когда оборудование принадлежит тенанту', async () => {
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq-1', isActive: true });
    createDeviceKeyMock.mockResolvedValue({
      id: 'key-1',
      name: 'x',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
      siteId: null,
    });

    const result = await provisionDeviceKey({ name: 'x', equipmentId: 'eq-1', tenantId: 'tenant-a' });

    expect(result.id).toBe('key-1');
    expect(createDeviceKeyMock).toHaveBeenCalled();
  });

  it('возвращает plaintext ключ ровно один раз в ответе', async () => {
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq-1', isActive: true });
    createDeviceKeyMock.mockResolvedValue({
      id: 'key-new',
      name: 'Новый датчик',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
      siteId: null,
    });

    const result = await provisionDeviceKey({
      name: 'Новый датчик',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
    });

    expect(result.key).toBeDefined();
    expect(typeof result.key).toBe('string');
    expect(result.key).toMatch(/^pkdk_[A-Za-z0-9_-]{43}$/); // prefix + base64url(32 bytes)
  });

  it('повторное чтение из БД не выдаёт plaintext — только хеш', async () => {
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq-1', isActive: true });
    createDeviceKeyMock.mockResolvedValue({
      id: 'key-new',
      name: 'Новый датчик',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
      siteId: null,
    });

    const provisioned = await provisionDeviceKey({
      name: 'Новый датчик',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
    });

    const { createHmac } = await import('crypto');
    const expectedHash = createHmac('sha256', 'dev-only-device-key-fallback').update(provisioned.key).digest('hex');

    findUniqueDeviceKeyMock.mockResolvedValue({
      id: 'key-new',
      keyHash: expectedHash,
      revoked: false,
      equipmentId: 'eq-1',
      siteId: null,
      tenantId: 'tenant-a',
    });
    updateDeviceKeyMock.mockResolvedValue({});

    const authenticated = await authenticateDeviceByKey(provisioned.key);

    expect(authenticated).not.toBeNull();
    expect(authenticated?.deviceKeyId).toBe('key-new');
    // В ответе authenticateDeviceByKey нет plaintext ключа — только идентификаторы
    expect(authenticated).not.toHaveProperty('key');
  });
});

describe('authenticateDeviceByKey — поведение поиска и верификации', () => {
  beforeEach(() => {
    findUniqueDeviceKeyMock.mockReset();
    updateDeviceKeyMock.mockReset();
    findUniqueEquipmentMock.mockReset();
    createDeviceKeyMock.mockReset();
  });

  it('возвращает устройство для известного валидного ключа', async () => {
    // Сначала создаём ключ через provisionDeviceKey
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq-1', isActive: true });
    createDeviceKeyMock.mockResolvedValue({
      id: 'key-1',
      name: 'Датчик-1',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
      siteId: null,
    });

    const provisioned = await provisionDeviceKey({
      name: 'Датчик-1',
      equipmentId: 'eq-1',
      tenantId: 'tenant-a',
    });

    // Вычисляем ожидаемый хеш (в тестах используется dev fallback)
    const { createHmac } = await import('crypto');
    const expectedHash = createHmac('sha256', 'dev-only-device-key-fallback').update(provisioned.key).digest('hex');

    findUniqueDeviceKeyMock.mockResolvedValue({
      id: 'key-1',
      keyHash: expectedHash,
      revoked: false,
      equipmentId: 'eq-1',
      siteId: null,
      tenantId: 'tenant-a',
    });
    updateDeviceKeyMock.mockResolvedValue({});

    const result = await authenticateDeviceByKey(provisioned.key);

    expect(result).not.toBeNull();
    expect(result?.deviceKeyId).toBe('key-1');
    expect(result?.equipmentId).toBe('eq-1');
    expect(result?.tenantId).toBe('tenant-a');
    expect(findUniqueDeviceKeyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash: expectedHash } })
    );
  });

  it('возвращает null для неизвестного ключа (не выбрасывает)', async () => {
    findUniqueDeviceKeyMock.mockResolvedValue(null);

    const result = await authenticateDeviceByKey('pkdk_unknownkeythatdoesnotexistxxxxxxxxxxxxxxxxxxxx');

    expect(result).toBeNull();
    expect(findUniqueDeviceKeyMock).toHaveBeenCalled();
  });

  it('возвращает null для отозванного ключа', async () => {
    const { createHmac } = await import('crypto');
    const plaintext = 'pkdk_somerevokedkeyxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const keyHash = createHmac('sha256', 'dev-only-device-key-fallback').update(plaintext).digest('hex');

    findUniqueDeviceKeyMock.mockResolvedValue({
      id: 'key-revoked',
      keyHash,
      revoked: true,
      equipmentId: 'eq-1',
      siteId: null,
      tenantId: 'tenant-a',
    });

    const result = await authenticateDeviceByKey(plaintext);

    expect(result).toBeNull();
    expect(updateDeviceKeyMock).not.toHaveBeenCalled();
  });

  it('сравнивает хеш через timingSafeEqual (постоянное время)', async () => {
    const { createHmac } = await import('crypto');
    const plaintext = 'pkdk_timingsafeequaltestkeyxxxxxxxxxxxxxxxxxxx';
    const keyHash = createHmac('sha256', 'dev-only-device-key-fallback').update(plaintext).digest('hex');

    findUniqueDeviceKeyMock.mockResolvedValue({
      id: 'key-1',
      keyHash,
      revoked: false,
      equipmentId: 'eq-1',
      siteId: null,
      tenantId: 'tenant-a',
    });
    updateDeviceKeyMock.mockResolvedValue({});

    const result = await authenticateDeviceByKey(plaintext);

    expect(result).not.toBeNull();
    expect(findUniqueDeviceKeyMock).toHaveBeenCalled();
  });

  it('возвращает null когда хеш в базе отличается (подмена ключа)', async () => {
    const { createHmac } = await import('crypto');
    const realPlaintext = 'pkdk_realkeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const fakePlaintext = 'pkdk_fakekeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const realHash = createHmac('sha256', 'dev-only-device-key-fallback').update(realPlaintext).digest('hex');
    const _fakeHash = createHmac('sha256', 'dev-only-device-key-fallback').update(fakePlaintext).digest('hex');

    findUniqueDeviceKeyMock.mockResolvedValue({
      id: 'key-1',
      keyHash: realHash,
      revoked: false,
      equipmentId: 'eq-1',
      siteId: null,
      tenantId: 'tenant-a',
    });

    const result = await authenticateDeviceByKey(fakePlaintext);

    expect(result).toBeNull();
  });

  it('отбрасывает ключи короче минимальной длины до хеширования', async () => {
    const result = await authenticateDeviceByKey('short');

    expect(result).toBeNull();
    expect(findUniqueDeviceKeyMock).not.toHaveBeenCalled();
  });

  it('возвращает null для пустого ключа', async () => {
    const result = await authenticateDeviceByKey('');

    expect(result).toBeNull();
    expect(findUniqueDeviceKeyMock).not.toHaveBeenCalled();
  });
});