import { describe, it, expect } from 'vitest';
import {
  buildMaintenanceQuery,
  resolveAssigneeName,
  nextStatusActions,
  maintenanceErrorText,
  maintenanceCatchText,
} from '../maintenance-helpers';

describe('buildMaintenanceQuery', () => {
  it('omits empty filters', () => {
    expect(buildMaintenanceQuery({})).toBe('');
    expect(buildMaintenanceQuery({ status: 'PLANNED', assigneeId: '' })).toBe('?status=PLANNED');
  });
  it('includes multiple filters', () => {
    const q = buildMaintenanceQuery({ status: 'DONE', priority: 'HIGH' });
    expect(q.startsWith('?')).toBe(true);
    expect(q).toContain('status=DONE');
    expect(q).toContain('priority=HIGH');
  });
});

describe('resolveAssigneeName', () => {
  const map = new Map([['u1', 'Иванов']]);
  it('returns name when known', () => expect(resolveAssigneeName('u1', map)).toBe('Иванов'));
  it('returns dash when null/unknown', () => {
    expect(resolveAssigneeName(null, map)).toBe('—');
    expect(resolveAssigneeName('u9', map)).toBe('—');
  });
});

describe('nextStatusActions', () => {
  it('PLANNED can start and cancel', () => {
    expect(nextStatusActions('PLANNED')).toEqual(['IN_PROGRESS', 'CANCELLED']);
  });
  it('IN_PROGRESS can hold, done, cancel', () => {
    expect(nextStatusActions('IN_PROGRESS')).toEqual(['ON_HOLD', 'DONE', 'CANCELLED']);
  });
  it('DONE and CANCELLED are terminal', () => {
    expect(nextStatusActions('DONE')).toEqual([]);
    expect(nextStatusActions('CANCELLED')).toEqual([]);
  });
});

describe('maintenanceErrorText (F-R94-1, F-R94-2)', () => {
  it('401 — сессия истекла, а не серверное «Unauthorized»', () => {
    expect(maintenanceErrorText(401, 'Unauthorized')).toBe('Сессия истекла — войдите снова.');
  });
  it('403 — про права, отличается от сбоя', () => {
    expect(maintenanceErrorText(403)).toBe('Нет прав на обслуживание. Смените роль или обратитесь к администратору.');
  });
  it('404 — наряд не найден', () => {
    expect(maintenanceErrorText(404)).toBe('Наряд не найден (возможно, удалён).');
  });
  it('5xx — временная недоступность без технического кода', () => {
    expect(maintenanceErrorText(500)).toBe('Сервер временно недоступен — повторите позже.');
    expect(maintenanceErrorText(503)).toBe('Сервер временно недоступен — повторите позже.');
  });
  it('остальное — серверный текст (400/409 по делу), с общим фолбэком', () => {
    expect(maintenanceErrorText(409, 'Запись уже принята, изменения недоступны')).toBe('Запись уже принята, изменения недоступны');
    expect(maintenanceErrorText(400, '  ')).toBe('Не удалось выполнить действие.');
  });
});

describe('maintenanceCatchText (обрыв сети)', () => {
  it('TypeError («Failed to fetch») читается по-русски', () => {
    expect(maintenanceCatchText(new TypeError('Failed to fetch'), 'Ошибка')).toBe(
      'Нет связи с сервером — повторите при появлении сети.',
    );
  });
  it('прочее берётся из сообщения, иначе фолбэк', () => {
    expect(maintenanceCatchText(new Error('Запись ТО не найдена'), 'Ошибка')).toBe('Запись ТО не найдена');
    expect(maintenanceCatchText(undefined, 'Ошибка сохранения')).toBe('Ошибка сохранения');
  });
});
