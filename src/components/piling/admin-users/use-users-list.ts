'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import type { OperationalUserDTO, UserRole } from '@/lib/types';

export interface CreateUserInput {
  name: string;
  email: string;
  phone?: string;
  password?: string;
  pin?: string;
  role: UserRole;
}

export interface UpdateUserInput {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  password?: string;
  pin?: string;
}

function isOperationalUser(value: unknown): value is OperationalUserDTO {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<OperationalUserDTO>;
  return typeof user.id === 'string'
    && typeof user.name === 'string'
    && typeof user.email === 'string'
    && typeof user.phone === 'string'
    && Array.isArray(user.assignedSites)
    && typeof user.reportCount === 'number'
    && typeof user.canHardDelete === 'boolean';
}

function parseUsersPage(value: unknown): { users: OperationalUserDTO[]; nextCursor: string | null } {
  if (!value || typeof value !== 'object') throw new Error('Некорректный ответ сервера');
  const page = value as { users?: unknown; nextCursor?: unknown };
  if (!Array.isArray(page.users) || !page.users.every(isOperationalUser)) {
    throw new Error('Некорректные данные пользователей');
  }
  return {
    users: page.users,
    nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null,
  };
}

/**
 * Owns the paginated user list and CRUD operations. The host component
 * stays focused on layout, dialog visibility, and filter state.
 */
export function useUsersList() {
  const [users, setUsers] = useState<OperationalUserDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/users');
      if (!res.ok) {
        throw new Error('Ошибка загрузки пользователей');
      }
      const data = parseUsersPage(await res.json());
      let collected = data.users;
      let cursor = data.nextCursor;
      while (cursor) {
        const next = await authFetch(`/api/users?cursor=${cursor}`);
        if (!next.ok) throw new Error('Ошибка загрузки следующей страницы');
        const nextData = parseUsersPage(await next.json());
        collected = collected.concat(nextData.users);
        cursor = nextData.nextCursor;
      }
      setUsers(collected);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Ошибка загрузки пользователей';
      setError(message);
      toast.error('Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void load();
  }, [load]);

  const create = async (input: CreateUserInput) => {
    const res = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка создания');
    }
    await load();
  };

  const update = async (input: UpdateUserInput) => {
    const body: Record<string, unknown> = {
      id: input.id,
      name: input.name,
      email: input.email,
      role: input.role,
      phone: input.phone,
    };
    if (input.password) {
      body.password = input.password;
    }
    if (input.pin) {
      body.pin = input.pin;
    }
    const res = await authFetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка сохранения');
    }
    await load();
  };

  const remove = async (id: string) => {
    const res = await authFetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Ошибка удаления');
    }
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  const toggleActive = async (user: OperationalUserDTO) => {
    try {
      const res = await authFetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
      });
      if (!res.ok) throw new Error();
      await load();
      toast.success(user.isActive ? 'Пользователь деактивирован' : 'Пользователь активирован');
    } catch {
      toast.error('Ошибка изменения статуса');
    }
  };

  return { users, loading, error, retry: load, create, update, remove, toggleActive };
}
