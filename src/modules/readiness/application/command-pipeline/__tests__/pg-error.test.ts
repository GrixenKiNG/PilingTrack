import {describe, expect, it} from 'vitest';
import {postgresErrorCode} from '../pg-error';

/*
  Код PostgreSQL из ошибки Prisma, где бы он ни лежал. Драйверный адаптер (PrismaPg)
  кладёт настоящий SQLSTATE в meta.driverAdapterError.cause.originalCode, а сверху
  ставит оболочку P2010 («Raw query failed») или P2039. Разбирать только оболочку
  нельзя: под ней прячутся и таймаут блокировки, и серализационный сбой, и ошибка
  синтаксиса, а вести они должны себя по-разному.
*/
describe('postgresErrorCode', () => {
  it('берёт SQLSTATE из драйверного адаптера под оболочкой P2010 и P2039', () => {
    for (const shell of ['P2010', 'P2039']) {
      expect(postgresErrorCode({code: shell, meta: {driverAdapterError: {cause: {originalCode: '55P03'}}}})).toBe('55P03');
    }
  });

  it('при отсутствии адаптера берёт meta.code, затем code', () => {
    expect(postgresErrorCode({code: 'P2010', meta: {code: '40001'}})).toBe('40001');
    expect(postgresErrorCode({code: 'P2034'})).toBe('P2034');
  });

  it('внутренний код главнее оболочки', () => {
    expect(postgresErrorCode({code: 'P2010', meta: {code: '40P01', driverAdapterError: {cause: {originalCode: '42601'}}}})).toBe('42601');
  });

  it('не падает на мусоре и пустых значениях', () => {
    expect(postgresErrorCode(null)).toBeNull();
    expect(postgresErrorCode(undefined)).toBeNull();
    expect(postgresErrorCode('строка')).toBeNull();
    expect(postgresErrorCode({})).toBeNull();
  });
});
