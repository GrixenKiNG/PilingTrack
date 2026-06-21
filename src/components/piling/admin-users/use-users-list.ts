'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import type { UserDTO, UserRole } from '@/lib/types';

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password?: string;
}

/**
 * Owns the paginated user list and CRUD operations. The host component
 * stays focused on layout, dialog visibility, and filter state.
 */
export function useUsersList() {
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/users');
      if (!res.ok) {
        throw new Error('Ошибка загрузки пользователей');
      }
      const data = await res.json();
      let collected: UserDTO[] = data.users || [];
      let cursor: string | null = data.nextCursor || null;
      while (cursor) {
        const next = await authFetch(`/api/users?cursor=${cursor}`);
        if (!next.ok) break;
        const nextData = await next.json();
        collected = collected.concat(nextData.users || []);
        cursor = nextData.nextCursor || null;
      }
      setUsers(collected);
    } catch {
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
    const data = await res.json();
    setUsers((prev) => [...prev, data.user]);
  };

  const update = async (input: UpdateUserInput) => {
    const body: Record<string, unknown> = {
      id: input.id,
      name: input.name,
      email: input.email,
      role: input.role,
    };
    if (input.password) {
      body.password = input.password;
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
    const data = await res.json();
    setUsers((prev) => prev.map((u) => (u.id === input.id ? data.user : u)));
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

  const toggleActive = async (user: UserDTO) => {
    try {
      const res = await authFetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
      });
      if (!res.ok) throw new Error();
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u))
      );
      toast.success(user.isActive ? 'Пользователь деактивирован' : 'Пользователь активирован');
    } catch {
      toast.error('Ошибка изменения статуса');
    }
  };

  return { users, loading, create, update, remove, toggleActive };
}
