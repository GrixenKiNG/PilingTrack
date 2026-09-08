import { describe, expect, it } from 'vitest';
import type { OperationalUserDTO, UserRole } from '@/lib/types';
import { computeUserKpis, filterOperationalUsers } from '../user-list-model';

const NOW = new Date('2026-06-22T12:00:00.000Z');

function user(
  id: string,
  overrides: Partial<OperationalUserDTO> = {}
): OperationalUserDTO {
  return {
    id,
    email: `${id}@example.test`,
    name: `Пользователь ${id}`,
    phone: `+7000000000${id.slice(-1)}`,
    role: 'OPERATOR' as UserRole,
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    assignedSites: [{ id: 'site-1', name: 'ВСМЖ' }],
    activeCrew: {
      id: 'crew-1',
      name: 'Экипаж',
      equipmentName: 'LRH-100',
      siteName: 'ВСМЖ',
    },
    reportCount: 1,
    canHardDelete: false,
    lastReportAt: '2026-06-20T00:00:00.000Z',
    lastLoginAt: '2026-06-21T00:00:00.000Z',
    lastActivityAt: '2026-06-21T00:00:00.000Z',
    lastActivitySource: 'login',
    ...overrides,
  };
}

const users = [
  user('u1', {
    name: 'Анна Сидорова',
    email: 'assistant@example.test',
    phone: '+79991234567',
    role: 'ASSISTANT',
    createdAt: '2026-04-01T00:00:00.000Z',
    assignedSites: [],
    activeCrew: null,
    reportCount: 0,
    lastReportAt: null,
    lastLoginAt: null,
    lastActivityAt: null,
    lastActivitySource: null,
  }),
  user('u2', { name: 'Иван Петров', isActive: false }),
  user('u3', { role: 'ADMIN', activeCrew: null }),
  user('u4', { role: 'DISPATCHER' }),
  // Машинист без объекта и бригады — единственный, кому закрепление положено.
  user('u5', { name: 'Пётр Новиков', assignedSites: [], activeCrew: null }),
];

describe('filterOperationalUsers', () => {
  it.each([
    ['assistants', ['u1']],
    ['blocked', ['u2']],
    ['no-site', ['u5']],
    ['no-crew', ['u5']],
    ['inactive-30-days', ['u1']],
    ['operators', ['u2', 'u5']],
    ['dispatchers', ['u4']],
    ['admins', ['u3']],
  ] as const)('applies the %s quick filter', (quick, expectedIds) => {
    const result = filterOperationalUsers(users, { quick, search: '', now: NOW });

    expect(result.map((item) => item.id)).toEqual(expectedIds);
  });

  it.each(['анна', 'ASSISTANT@EXAMPLE.TEST', '9991234567'])(
    'searches case-insensitively by name, email or phone: %s',
    (search) => {
      const result = filterOperationalUsers(users, { quick: 'all', search, now: NOW });

      expect(result.map((item) => item.id)).toEqual(['u1']);
    }
  );

  /*
    Правка карточки администратором — не активность сотрудника. Уволенный
    оператор, которому поправили телефон, переставал попадать в фильтр
    неиспользуемых записей: отметку о его «активности» ставил другой человек.
  */
  it('does not treat an administrator edit as the employee own activity', () => {
    const edited = user('edited', {
      lastLoginAt: '2026-01-10T00:00:00.000Z',
      lastReportAt: null,
      lastActivityAt: NOW.toISOString(),
      lastActivitySource: 'profile',
    });

    expect(filterOperationalUsers([edited], {
      quick: 'inactive-30-days', search: '', now: NOW,
    }).map((item) => item.id)).toEqual(['edited']);
  });

  it.each(['+79991234567', '89991234567', '9991234567', '999 123 45 67'])(
    'finds a phone typed in any shape: %s',
    (search) => {
      const result = filterOperationalUsers(users, { quick: 'all', search, now: NOW });

      expect(result.map((item) => item.id)).toEqual(['u1']);
    }
  );

  it('does not mark a newly-created user with no activity as inactive for 30 days', () => {
    const recent = user('recent', {
      lastActivityAt: null,
      lastActivitySource: null,
      createdAt: '2026-06-10T00:00:00.000Z',
    });

    expect(filterOperationalUsers([recent], {
      quick: 'inactive-30-days',
      search: '',
      now: NOW,
    })).toEqual([]);
  });
});

describe('computeUserKpis', () => {
  it('returns operational counts', () => {
    expect(computeUserKpis(users)).toEqual([
      expect.objectContaining({ label: 'Всего', value: '5' }),
      expect.objectContaining({ label: 'Доступ включён', value: '4' }),
      expect.objectContaining({ label: 'Операторы', value: '2' }),
      expect.objectContaining({ label: 'Требуют закрепления', value: '1' }),
      expect.objectContaining({ label: 'Заблокированы', value: '1', tone: 'red' }),
    ]);
  });
});
