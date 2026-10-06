/**
 * Настройки организации: чтение, запись, умолчания и отказ без организации.
 *
 * Пиннит то, на что опираются шапка контура, производственные сутки и
 * выключатели уведомлений: организация без строки настроек получает умолчания
 * (а не null), служба без организации падает до похода в базу (fail closed), а
 * негодный часовой пояс из базы не доходит до Intl — иначе любое форматирование
 * даты в поясе тенанта падало бы RangeError.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, upsertMock, executeRawMock, transactionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  // saveSettings читает «до» и пишет объединённый набор под advisory-замком в
  // одной транзакции; замок возвращает void и берётся через $executeRaw.
  executeRawMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    tenantSettings: { findUnique: findUniqueMock, upsert: upsertMock },
    $executeRaw: executeRawMock,
  };
  return {
    db: {
      // getSettings читает через глобальный клиент.
      tenantSettings: { findUnique: findUniqueMock },
      $transaction: (cb: (t: typeof tx) => unknown) => {
        transactionMock();
        return cb(tx);
      },
    },
  };
});

import { getSettings, saveSettings } from '../application/settings-service';
import { DEFAULT_WORKSPACE_SETTINGS, sanitizeSettings } from '../domain/settings';

/** Строка настроек, уже лежащая в базе. */
const storedRow = {
  companyName: 'ООО «Орион»',
  inn: '7701234567',
  timezone: 'Asia/Yekaterinburg',
  dateFormat: 'DD.MM.YYYY',
  units: 'metric',
  currency: 'RUB',
  notifications: { downtime30: false, newReports: true },
};

describe('getSettings', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
  });

  it('падает без организации и не читает базу (fail closed)', async () => {
    await expect(getSettings('')).rejects.toThrow('tenantId is required');
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('организации без строки настроек отдаёт умолчания, а не null', async () => {
    findUniqueMock.mockResolvedValue(null);

    const settings = await getSettings('tenant-new');

    expect(findUniqueMock).toHaveBeenCalledWith({ where: { tenantId: 'tenant-new' } });
    expect(settings).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(settings.timezone).toBe('Europe/Moscow');
    // Умолчания не должны быть общим изменяемым объектом: правка на месте не
    // должна портить умолчания для всех остальных организаций.
    settings.notifications.downtime30 = false;
    expect(DEFAULT_WORKSPACE_SETTINGS.notifications.downtime30).toBe(true);
  });

  it('читает сохранённые значения и добивает недостающие ключи уведомлений умолчаниями', async () => {
    findUniqueMock.mockResolvedValue(storedRow);

    const settings = await getSettings('tenant-a');

    expect(settings.companyName).toBe('ООО «Орион»');
    expect(settings.timezone).toBe('Asia/Yekaterinburg');
    expect(settings.notifications.downtime30).toBe(false); // явное false владельца
    expect(settings.notifications.newReports).toBe(true);
    // Ключа в сохранённом наборе не было — подставляется умолчание каталога.
    expect(settings.notifications.criticalDefect).toBe(true);
  });

  it('негодный часовой пояс из базы заменяет на умолчание, чтобы Intl не падал', async () => {
    findUniqueMock.mockResolvedValue({ ...storedRow, timezone: 'UTC+3' });

    const settings = await getSettings('tenant-a');

    expect(settings.timezone).toBe('Europe/Moscow');
    // Значение реально пригодно для того конструктора, которым его потом читают.
    expect(() => new Intl.DateTimeFormat('ru-RU', { timeZone: settings.timezone })).not.toThrow();
  });
});

describe('saveSettings', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    upsertMock.mockReset();
    executeRawMock.mockReset();
    transactionMock.mockReset();
    executeRawMock.mockResolvedValue(1);
    upsertMock.mockImplementation(async (args: { create: unknown }) => args.create);
  });

  it('падает без организации и не открывает транзакцию (fail closed)', async () => {
    await expect(saveSettings('', { companyName: 'ООО «Новое»' }, 'admin-1'))
      .rejects.toThrow('tenantId is required');
    expect(transactionMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('первое сохранение заводит строку: патч поверх умолчаний, чужие поля — умолчания', async () => {
    findUniqueMock.mockResolvedValue(null); // у организации строки ещё нет

    const saved = await saveSettings('tenant-new', { companyName: 'ООО «Новое»' }, 'admin-7');

    expect(saved.companyName).toBe('ООО «Новое»');
    expect(saved.timezone).toBe('Europe/Moscow');
    expect(saved.notifications.downtime30).toBe(true);

    const [{ where, create, update }] = upsertMock.mock.calls[0];
    expect(where).toEqual({ tenantId: 'tenant-new' });
    expect(create).toMatchObject({
      tenantId: 'tenant-new',
      updatedBy: 'admin-7',
      companyName: 'ООО «Новое»',
      timezone: 'Europe/Moscow',
      currency: 'RUB',
    });
    expect(update).toMatchObject({ updatedBy: 'admin-7', companyName: 'ООО «Новое»' });
  });

  it('негодный часовой пояс из патча не сохраняется', async () => {
    findUniqueMock.mockResolvedValue(null);

    const saved = await saveSettings('tenant-new', { timezone: 'Мск' }, 'admin-7');

    expect(saved.timezone).toBe('Europe/Moscow');
  });
});

describe('sanitizeSettings', () => {
  it('не сохраняет ключ уведомления вне каталога правил', () => {
    const settings = sanitizeSettings({ notifications: { downtime30: false, notARealRule: true } });

    expect(settings.notifications.downtime30).toBe(false);
    expect(settings.notifications).not.toHaveProperty('notARealRule');
  });

  it('единицы измерения и слишком длинную строку отбрасывает к базе', () => {
    const base = { ...DEFAULT_WORKSPACE_SETTINGS, companyName: 'ООО «Орион»', units: 'metric' };

    const settings = sanitizeSettings({ companyName: 'x'.repeat(201), units: 'furlongs' }, base);

    expect(settings.units).toBe('metric');
    expect(settings.companyName).toBe('ООО «Орион»');
  });
});