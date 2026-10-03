import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalUserDTO } from '@/lib/types';

const useUsersListMock = vi.fn();

vi.mock('../use-users-list', () => ({
  useUsersList: () => useUsersListMock(),
}));

const authFetchMock = vi.fn();
vi.mock('@/lib/api', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));

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
    authFetchMock.mockReset();
    // Экран хранит фильтр/поиск/выбранного сотрудника в адресе страницы, а
    // window.location в jsdom общий для файла: без сброса следующий тест
    // начинает с поисковой строки предыдущего.
    window.history.replaceState(null, '', '/');
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

  /**
   * R73: «Редактировать/Заблокировать/Удалить» (32px) и кнопки шапки (40px)
   * были ниже 44px на телефоне. Блокировка доступа и удаление идут рядом —
   * промах пальцем по паре кнопок стоит не того действия. Правка только на
   * телефоне: `h-11 … sm:h-8` / `h-11 … sm:h-10`, на десктопе вид прежний.
   */
  it('держит кнопки карточки и шапки не ниже 44px на телефоне (R73)', () => {
    useUsersListMock.mockReturnValue({
      users: [operationalUser({ canHardDelete: true })],
      loading: false,
      error: null,
      retry: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      toggleActive: vi.fn(),
    });
    render(<AdminUsers />);

    expect(screen.getByRole('button', { name: /Виды документов/ })).toHaveClass('h-11', 'sm:h-10');
    expect(screen.getByRole('button', { name: /Новый пользователь/ })).toHaveClass('h-11', 'sm:h-10');

    // Radix Tabs переключает вкладку по mousedown, не по click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Доступ' }));
    for (const name of [/Редактировать/, /Заблокировать/, /Удалить/]) {
      expect(screen.getByRole('button', { name })).toHaveClass('h-11', 'text-xs', 'sm:h-8');
    }
  });

  /** R73: тот же размер у кнопок справочника видов документов (32px). */
  it('держит кнопки справочника видов документов не ниже 44px на телефоне (R73)', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        types: [{
          id: 'type-1', name: 'Медосмотр', requiresExpiry: true, defaultValidMonths: 12,
          leadTimeDays: 30, requiredForOperator: false, isActive: true, documentCount: 0,
        }],
      }),
    });
    render(<AdminUsers />);

    fireEvent.click(screen.getByRole('button', { name: /Виды документов/ }));

    for (const name of ['Изменить', 'Требовать для смены', 'Отключить']) {
      expect(await screen.findByRole('button', { name })).toHaveClass('h-11', 'text-2xs', 'sm:h-8');
    }
    expect(screen.getByLabelText('Удалить вид «Медосмотр»')).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
  });

  /**
   * R113-5: «Заблокировать» отправляла PUT /api/users {isActive:false} одним
   * кликом. Блокировка повышает sessionVersion и немедленно выкидывает человека
   * из системы — рядом удаление подтверждение имело, блокировка нет.
   */
  it('блокировка спрашивает подтверждение и вызывает toggleActive только после согласия (R113-5)', async () => {
    const toggleActive = vi.fn();
    useUsersListMock.mockReturnValue({
      users: [operationalUser()],
      loading: false,
      error: null,
      retry: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      toggleActive,
    });
    render(<AdminUsers />);

    // Radix Tabs переключает вкладку по mousedown, не по click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Доступ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(toggleActive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать доступ' }));

    expect(toggleActive).toHaveBeenCalledTimes(1);
  });
});
