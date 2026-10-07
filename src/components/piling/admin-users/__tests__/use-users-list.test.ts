/**
 * W52: логика хука `useUsersList` не выполнялась ни одним тестом —
 * в `admin-users.test.tsx` модуль замокан целиком (`vi.mock('../use-users-list')`),
 * поэтому разбор ответа, пагинация по курсору и ветки 401 в
 * create/update/remove/toggleActive оставались без проверки. Здесь хук
 * тестируется напрямую, без мока самого модуля: `authFetch` отдаёт заданные
 * ответы, а проверяются `parseUsersPage`, сбор страниц и тексты отказов.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import type { OperationalUserDTO } from '@/lib/types';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useUsersList } from '../use-users-list';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function operationalUser(overrides: Partial<OperationalUserDTO> = {}): OperationalUserDTO {
  return {
    id: 'user-1',
    email: 'anna@example.test',
    name: 'Анна Сидорова',
    phone: '+799****4567',
    role: 'OPERATOR',
    isActive: true,
    createdAt: '2026-06-01T08:00:00.000Z',
    assignedSites: [{ id: 'site-1', name: 'ВСМЖ' }],
    activeCrew: null,
    reportCount: 4,
    canHardDelete: false,
    lastReportAt: null,
    lastLoginAt: null,
    lastActivityAt: null,
    lastActivitySource: null,
    ...overrides,
  };
}

describe('useUsersList — разбор страницы и пагинация (W52)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('собирает все страницы по курсору и снимает загрузку', async () => {
    mocks.authFetch.mockImplementation((url: string) => {
      if (url === '/api/users') return Promise.resolve(json({ users: [operationalUser()], nextCursor: 'c1' }));
      if (url === '/api/users?cursor=c1') {
        return Promise.resolve(json({ users: [operationalUser({ id: 'user-2', name: 'Борис Петров' })], nextCursor: null }));
      }
      return Promise.resolve(json({ users: [], nextCursor: null }));
    });

    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.users.map((u) => u.id)).toEqual(['user-1', 'user-2']);
  });

  it('некорректная страница → ошибка разбора, а не молча пустой список', async () => {
    // `id` числом не проходит `isOperationalUser` — страница считается битой.
    mocks.authFetch.mockResolvedValue(json({ users: [{ id: 1, name: 'Анна' }], nextCursor: null }));

    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Некорректные данные пользователей');
    expect(result.current.users).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith('Ошибка загрузки пользователей');
  });

  it('отказ первой страницы → ошибка загрузки, список пуст', async () => {
    mocks.authFetch.mockResolvedValue(json({ error: 'Ошибка сервера' }, 500));

    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Ошибка загрузки пользователей');
    expect(result.current.users).toEqual([]);
  });

  it('отказ страницы по курсору → своя ошибка, когда данные уже есть', async () => {
    mocks.authFetch.mockImplementation((url: string) => {
      if (url === '/api/users') return Promise.resolve(json({ users: [operationalUser()], nextCursor: 'c1' }));
      return Promise.resolve(json({ error: 'Unauthorized' }, 401));
    });

    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Ошибка загрузки следующей страницы');
  });
});

describe('useUsersList — ветки 401 в операциях (F-R112-1)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  /** Загрузка списка успешна, а мутация отвечает заданным образом. */
  function routeMutation(response: Response) {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method && init.method !== 'GET'
        ? Promise.resolve(response)
        : Promise.resolve(json({ users: [operationalUser()], nextCursor: null })),
    );
  }

  it('create: 401 → «Сессия истекла — войдите снова.»', async () => {
    routeMutation(json({ error: 'Unauthorized' }, 401));
    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.create({ name: 'Новый', email: 'new@example.test', role: 'OPERATOR' }),
    ).rejects.toThrow('Сессия истекла — войдите снова.');
  });

  it('update: 401 → «Сессия истекла — войдите снова.»', async () => {
    routeMutation(json({ error: 'Unauthorized' }, 401));
    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.update({ id: 'user-1', name: 'Анна', email: 'anna@example.test', role: 'OPERATOR' }),
    ).rejects.toThrow('Сессия истекла — войдите снова.');
  });

  it('remove: 401 → «Сессия истекла — войдите снова.»', async () => {
    routeMutation(json({ error: 'Unauthorized' }, 401));
    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.remove('user-1')).rejects.toThrow('Сессия истекла — войдите снова.');
  });

  it('toggleActive: 401 показывается тостом, а не сырым «Unauthorized»', async () => {
    routeMutation(json({ error: 'Unauthorized' }, 401));
    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.toggleActive(operationalUser()); });

    expect(toast.error).toHaveBeenCalledWith('Сессия истекла — войдите снова.');
    expect(toast.error).not.toHaveBeenCalledWith('Unauthorized');
  });

  it('create: не-401 отказ несёт серверную причину', async () => {
    routeMutation(json({ error: 'Пользователь уже существует' }, 409));
    const { result } = renderHook(() => useUsersList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.create({ name: 'Новый', email: 'new@example.test', role: 'OPERATOR' }),
    ).rejects.toThrow('Пользователь уже существует');
  });
});
