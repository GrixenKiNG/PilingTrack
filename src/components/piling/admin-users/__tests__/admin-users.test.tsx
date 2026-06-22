import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalUserDTO } from '@/lib/types';

const useUsersListMock = vi.fn();

vi.mock('../use-users-list', () => ({
  useUsersList: () => useUsersListMock(),
}));

vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: { currentUser: { id: string } }) => unknown) =>
    selector({ currentUser: { id: 'admin-current' } }),
}));

vi.mock('@/components/piling/ops-shell/use-entity-history', () => ({
  useEntityHistory: () => ({ entries: [], loading: false, error: false }),
}));

import { AdminUsers } from '../admin-users';

function operationalUser(overrides: Partial<OperationalUserDTO> = {}): OperationalUserDTO {
  return {
    id: 'user-1',
    email: 'anna@example.test',
    name: 'Анна Сидорова',
    phone: '+79991234567',
    role: 'OPERATOR',
    isActive: true,
    createdAt: '2026-06-01T08:00:00.000Z',
    assignedSites: [{ id: 'site-1', name: 'ВСМЖ' }],
    activeCrew: {
      id: 'crew-1',
      name: 'Экипаж',
      equipmentName: 'LRH-100',
      siteName: 'ВСМЖ',
    },
    reportCount: 4,
    canHardDelete: false,
    lastReportAt: '2026-06-20T10:00:00.000Z',
    lastLoginAt: '2026-06-21T11:00:00.000Z',
    lastActivityAt: '2026-06-21T11:00:00.000Z',
    lastActivitySource: 'login',
    ...overrides,
  };
}

describe('AdminUsers', () => {
  beforeEach(() => {
    useUsersListMock.mockReturnValue({
      users: [
        operationalUser(),
        operationalUser({
          id: 'user-2',
          name: 'Борис Петров',
          email: 'boris@example.test',
          phone: '+78880001122',
          assignedSites: [],
          activeCrew: null,
          canHardDelete: true,
        }),
      ],
      loading: false,
      error: null,
      retry: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      toggleActive: vi.fn(),
    });
  });

  it('renders the operational columns and five detail tabs', () => {
    render(<AdminUsers />);

    expect(screen.getByText('Объект')).toBeInTheDocument();
    expect(screen.getByText('Бригада / установка')).toBeInTheDocument();
    expect(screen.getAllByText('Активность').length).toBeGreaterThanOrEqual(2);
    for (const tab of ['Обзор', 'Закрепление', 'Активность', 'Доступ', 'История']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
  });

  it('searches by phone', () => {
    render(<AdminUsers />);

    fireEvent.change(screen.getByPlaceholderText('ФИО, email или телефон'), {
      target: { value: '8880001122' },
    });

    expect(screen.getAllByText('Борис Петров').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Анна Сидорова')).not.toBeInTheDocument();
  });
});
