import { describe, it, expect } from 'vitest';
import { filterReadableMedia, type ReadableMediaRow } from '../media-auth';

/**
 * Пакетная выдача ссылок отдаёт несколько записей за один запрос, поэтому
 * проверка доступа перестаёт быть «пропустить или ответить 403» и становится
 * отбором. Опасность отбора в том, что одна лишняя строка утекает молча — её
 * никто не заметит, в отличие от 403. Отсюда тесты.
 */

const operator = { id: 'op-1', role: 'OPERATOR', tenantId: 'orion' };
const otherOperator = { id: 'op-2', role: 'OPERATOR', tenantId: 'orion' };
const admin = { id: 'adm-1', role: 'ADMIN', tenantId: 'orion' };

function row(over: Partial<ReadableMediaRow> = {}): ReadableMediaRow {
  return {
    id: 'm1',
    key: 'orion/report/m1.jpg',
    thumbnailKey: 'orion/report/m1-thumb.jpg',
    entityType: 'report',
    entityId: 'r1',
    isDeleted: false,
    uploadStatus: 'completed',
    userId: 'op-1',
    tenantId: 'orion',
    ...over,
  };
}

describe('filterReadableMedia', () => {
  it('отдаёт свою запись оператору', () => {
    expect(filterReadableMedia(operator, [row()]).map((m) => m.id)).toEqual(['m1']);
  });

  it('не отдаёт оператору чужое фото отчёта', () => {
    expect(filterReadableMedia(otherOperator, [row()])).toEqual([]);
  });

  it('одна запрещённая запись не роняет всю пачку и не протекает', () => {
    const rows = [row({ id: 'mine' }), row({ id: 'stranger', userId: 'op-2' })];
    expect(filterReadableMedia(operator, rows).map((m) => m.id)).toEqual(['mine']);
  });

  it('отбрасывает удалённые и незавершённые загрузки', () => {
    const rows = [
      row({ id: 'deleted', isDeleted: true }),
      row({ id: 'pending', uploadStatus: 'pending' }),
      row({ id: 'ok' }),
    ];
    expect(filterReadableMedia(operator, rows).map((m) => m.id)).toEqual(['ok']);
  });

  it('фото техники доступно любой роли своего тенанта и закрыто для чужого', () => {
    const equipment = row({ id: 'eq', entityType: 'equipment', entityId: 'e1', userId: 'adm-1' });
    expect(filterReadableMedia(operator, [equipment]).map((m) => m.id)).toEqual(['eq']);
    expect(filterReadableMedia({ id: 'x', role: 'OPERATOR', tenantId: 'other' }, [equipment])).toEqual([]);
    // Пустой тенант у актора — тот же отказ: политика fail-closed.
    expect(filterReadableMedia({ id: 'x', role: 'OPERATOR' }, [equipment])).toEqual([]);
  });

  it('администратор видит и своё, и чужое', () => {
    const rows = [row({ id: 'a', userId: 'op-1' }), row({ id: 'b', userId: 'op-2' })];
    expect(filterReadableMedia(admin, rows).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('пустой вход — пустой выход, без обращений к хранилищу', () => {
    expect(filterReadableMedia(operator, [])).toEqual([]);
  });
});
