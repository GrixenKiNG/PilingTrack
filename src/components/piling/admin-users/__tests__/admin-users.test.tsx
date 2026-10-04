import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { CreateUserDialog, EditUserDialog } from '../user-dialogs';

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
   * F-R114-4: список печатал год двузначным («21.06.26»), а карточка того же
   * сотрудника — четыре цифры. На длинной истории «26» и «27» неразличимы.
   */
  it('год активности в списке — четыре цифры, как в карточке (F-R114-4)', () => {
    render(<AdminUsers />);

    expect(screen.queryAllByText(/21\.06\.26,/)).toHaveLength(0);
    expect(screen.getAllByText(/21\.06\.2026,/).length).toBeGreaterThanOrEqual(1);
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

  /**
   * R113-6: «Требовать для смены» и «Отключить» в справочнике видов документов
   * меняли допуск операторов к смене одним кликом, без вопроса и пояснения.
   */
  it('«Требовать для смены» спрашивает подтверждение и шлёт PATCH только после согласия (R113-6)', async () => {
    authFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === 'PATCH'
      ? { ok: true, json: async () => ({}) }
      : {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Требовать для смены' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/операторы без действующего документа не начнут смену/)).toBeInTheDocument();
    expect(authFetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Требовать для смены' }));

    await waitFor(() =>
      expect(authFetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(true),
    );
  });
});

/**
 * R121-5: у полей пользователя не было maxLength, а zod-схема маршрута
 * (`userBaseSchema`) ограничивает имя 200, email 255, телефон 30, пароль 100.
 * Форма отправляла заведомо отклоняемый запрос и получала только
 * «Некорректные данные» без имени поля и предела.
 */
describe('диалоги пользователя: пределы длины как в zod-схеме (R121)', () => {
  it('создание: имя/email/телефон/пароль ограничены по длине', () => {
    render(<CreateUserDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByPlaceholderText('Иванов Иван')).toHaveAttribute('maxLength', '200');
    expect(screen.getByPlaceholderText('ivan@piling.ru')).toHaveAttribute('maxLength', '255');
    expect(screen.getByPlaceholderText('+7 999 000-00-00')).toHaveAttribute('maxLength', '30');
    expect(screen.getByPlaceholderText('Минимум 8 символов')).toHaveAttribute('maxLength', '100');
  });

  it('правка: имя/email/телефон/пароль ограничены по длине', () => {
    render(
      <EditUserDialog
        open
        user={operationalUser()}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Анна Сидорова')).toHaveAttribute('maxLength', '200');
    expect(screen.getByDisplayValue('anna@example.test')).toHaveAttribute('maxLength', '255');
    expect(screen.getByDisplayValue(/799/)).toHaveAttribute('maxLength', '30');
    expect(screen.getByPlaceholderText('••••••••')).toHaveAttribute('maxLength', '100');
  });
});

/**
 * F-R126-4: диалоги пользователя не ограничивали высоту — при открытой
 * экранной клавиатуре (визуальный вьюпорт ~500 px) диалог 540 px обрезался
 * сверху, крестик уходил за экран. Добавлены `max-h-[90vh]` и прокрутка.
 */
describe('диалоги пользователя: ограничены по высоте на коротком экране (F-R126-4)', () => {
  const contentOf = (title: string) =>
    screen.getByText(title).closest('[data-slot="dialog-content"]');

  it('создание: содержимое ограничено 90vh и прокручивается', () => {
    render(<CreateUserDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
    expect(contentOf('Новый пользователь')).toHaveClass('max-h-[90vh]', 'overflow-y-auto');
  });

  it('правка: содержимое ограничено 90vh и прокручивается', () => {
    render(
      <EditUserDialog
        open
        user={operationalUser()}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(contentOf('Редактировать пользователя')).toHaveClass('max-h-[90vh]', 'overflow-y-auto');
  });
});

/**
 * R121 №9: в справочнике видов документов «Название» не имело maxLength
 * (схема маршрута — 200), а «Срок, мес.» = «0» уходило на сервер как `0`,
 * хотя zod требует `int ≥ 1` — 400 «Некорректные данные» без имени поля.
 */
describe('справочник видов документов: пределы полей как в схеме (R121)', () => {
  it('название вида документа ограничено 200 знаками', async () => {
    authFetchMock.mockResolvedValue({ ok: true, json: async () => ({ types: [] }) });
    render(<AdminUsers />);

    fireEvent.click(screen.getByRole('button', { name: /Виды документов/ }));

    expect(await screen.findByLabelText('Название')).toHaveAttribute('maxLength', '200');
  });

  it('срок «0» уходит как «не задан», а не как отклоняемый сервером ноль', async () => {
    authFetchMock.mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ((init?.method === 'POST') ? {} : { types: [] }),
    }));
    render(<AdminUsers />);

    fireEvent.click(screen.getByRole('button', { name: /Виды документов/ }));
    fireEvent.change(await screen.findByLabelText('Название'), { target: { value: 'Стропальщик' } });
    fireEvent.change(screen.getByLabelText('Срок, мес.'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(
      authFetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(true));
    const post = authFetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
      name: 'Стропальщик',
      defaultValidMonths: null,
    });
  });
});

/**
 * F-R128-2: после создания, правки и блокировки/разблокировки пользователя
 * `load()` ставил loading=true и гасил весь список «Пользователи» скелетоном.
 * Полноэкранный скелетон теперь только на первой загрузке, когда списка ещё нет.
 */
describe('AdminUsers — повторная загрузка не гасит список (F-R128-2)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    window.history.replaceState(null, '', '/');
  });

  it('при повторной загрузке (список уже есть) таблица и фильтры остаются на месте', () => {
    useUsersListMock.mockReturnValue({
      users: [operationalUser()],
      loading: true,
      error: null,
      retry: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      toggleActive: vi.fn(),
    });
    render(<AdminUsers />);

    expect(screen.getByPlaceholderText('ФИО, email или телефон')).toBeInTheDocument();
    expect(screen.getByText('Бригада / установка')).toBeInTheDocument();
  });

  it('на первой загрузке (список пуст) показывается скелетон без таблицы', () => {
    useUsersListMock.mockReturnValue({
      users: [],
      loading: true,
      error: null,
      retry: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      toggleActive: vi.fn(),
    });
    render(<AdminUsers />);

    expect(screen.queryByPlaceholderText('ФИО, email или телефон')).not.toBeInTheDocument();
  });
});

/**
 * F-R128-3: кнопки карточки пользователя не блокировались на время запроса —
 * «Заблокировать/Разблокировать» шлёт PUT и ещё ждёт перечитывания списка,
 * второй клик отправлял второй запрос.
 */
describe('UserDetail — кнопки карточки блокируются на время запроса (F-R128-3)', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    window.history.replaceState(null, '', '/');
  });

  it('«Заблокировать» недоступна, пока блокировка не завершилась', async () => {
    let release: () => void = () => {};
    const toggleActive = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Заблокировать доступ' }));

    expect(toggleActive).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Заблокировать' })).toBeDisabled();

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Заблокировать' })).not.toBeDisabled());
  });
});
