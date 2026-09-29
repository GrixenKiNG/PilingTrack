import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, upsertMock, executeRawMock, queryRawMock, dbFindUniqueMock, transactionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
  // Чтение «до» и запись объединённого набора идут в одной транзакции под
  // advisory-замком pg_advisory_xact_lock — см. F-R38-11. Замок возвращает
  // void, поэтому берётся через $executeRaw: $queryRaw падает на
  // десериализации колонки void.
  executeRawMock: vi.fn(),
  queryRawMock: vi.fn(),
  dbFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    tenantSettings: { findUnique: findUniqueMock, upsert: upsertMock },
    $executeRaw: executeRawMock,
    $queryRaw: queryRawMock,
  };
  return {
    db: {
      // Чтение настроек не должно уходить в базу вне транзакции.
      tenantSettings: { findUnique: dbFindUniqueMock },
      $transaction: (cb: (t: typeof tx) => unknown) => {
        transactionMock();
        return cb(tx);
      },
    },
  };
});

import { saveSettings } from '../settings-service';

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

/** Строка настроек, уже лежащая в базе: пришла от другого администратора. */
const storedRow = {
  companyName: 'ООО «Орион»',
  inn: '',
  timezone: 'Asia/Yekaterinburg',
  dateFormat: 'DD.MM.YYYY',
  units: 'metric',
  currency: 'RUB',
  notifications: { downtime30: false, newReports: false },
};

describe('saveSettings', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    upsertMock.mockReset();
    executeRawMock.mockReset();
    queryRawMock.mockReset();
    dbFindUniqueMock.mockReset();
    transactionMock.mockReset();
    findUniqueMock.mockResolvedValue(storedRow);
    upsertMock.mockImplementation(async (args: { create: unknown }) => args.create);
    executeRawMock.mockResolvedValue(1);
  });

  it('берёт advisory-замок на настройки организации раньше чтения и записи (F-R38-11)', async () => {
    await saveSettings('tenant-a', { companyName: 'ООО «Новое»' }, 'admin-1');

    // Замок — первый оператор внутри транзакции.
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const call = executeRawMock.mock.calls[0];
    expect(sqlOf(call)).toMatch(/SELECT pg_advisory_xact_lock\(hashtext\(\?\)\)/);
    expect(call.slice(1)).toEqual(['settings:tenant-a']);
    // $queryRaw для замка не используется: колонка void ломает десериализацию.
    expect(queryRawMock).not.toHaveBeenCalled();
    // Чтение предыдущего набора — под замком, тем же клиентом транзакции.
    expect(executeRawMock.mock.invocationCallOrder[0])
      .toBeLessThan(findUniqueMock.mock.invocationCallOrder[0]);
    expect(dbFindUniqueMock).not.toHaveBeenCalled();
  });

  it('сливает патч с тем, что лежит в базе, не затирая чужие поля', async () => {
    // Второй администратор сохраняет переключатель уведомления, пока первый
    // менял часовой пояс: набор читается заново под замком, поэтому правка
    // часового пояса переживает чужое сохранение.
    const saved = await saveSettings('tenant-a', { companyName: 'ООО «Новое»' }, 'admin-2');

    expect(saved.companyName).toBe('ООО «Новое»');
    expect(saved.timezone).toBe('Asia/Yekaterinburg');
    expect(saved.notifications.downtime30).toBe(false);

    const [{ update }] = upsertMock.mock.calls[0];
    expect(update.timezone).toBe('Asia/Yekaterinburg');
    expect(update.updatedBy).toBe('admin-2');
  });
});
