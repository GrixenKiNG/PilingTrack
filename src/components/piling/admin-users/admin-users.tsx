'use client';

import { useMemo, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { HeroKpi } from '@/components/piling/hero-kpi';
import { usePilingStore } from '@/lib/store';
import { ROLE_LABELS, type UserDTO, type UserRole } from '@/lib/types';
import { useUsersList } from './use-users-list';
import { UserRow } from './user-row';
import { UserFilters } from './user-filters';
import {
  CreateUserDialog,
  EditUserDialog,
  DeleteUserDialog,
} from './user-dialogs';
import { ROLE_CONFIG } from './role-config';

export function AdminUsers() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const { users, loading, create, update, remove, toggleActive } = useUsersList();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<UserDTO | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserDTO | null>(null);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...users]
      .filter((u) => (roleFilter === 'ALL' ? true : u.role === roleFilter))
      .filter((u) => {
        if (!query) return true;
        return (
          u.name.toLowerCase().includes(query) ||
          u.email.toLowerCase().includes(query) ||
          ROLE_LABELS[u.role].toLowerCase().includes(query)
        );
      })
      .sort((left, right) => {
        const roleOrder = ROLE_CONFIG[left.role].order - ROLE_CONFIG[right.role].order;
        if (roleOrder !== 0) return roleOrder;
        return left.name.localeCompare(right.name, 'ru');
      });
  }, [roleFilter, search, users]);

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground">Пользователи</h1>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-orange-500 text-white hover:bg-orange-600"
        >
          <Plus className="mr-1 h-4 w-4" />
          Новый пользователь
        </Button>
      </div>

      <HeroKpi
        label="Активные пользователи"
        value={users.filter((u) => u.isActive).length}
        unit={`/ ${users.length}`}
        icon={Users}
        detail={(() => {
          const counts: Record<UserRole, number> = { ADMIN: 0, DISPATCHER: 0, OPERATOR: 0, ASSISTANT: 0 };
          for (const u of users) if (u.isActive) counts[u.role] += 1;
          const parts = (Object.keys(counts) as UserRole[])
            .filter((r) => counts[r] > 0)
            .map((r) => `${counts[r]} ${ROLE_LABELS[r].toLowerCase()}`);
          return <span className="font-mono tabular-nums">{parts.join(' · ')}</span>;
        })()}
      />

      <UserFilters
        search={search}
        roleFilter={roleFilter}
        onSearchChange={setSearch}
        onRoleFilterChange={setRoleFilter}
      />

      {filteredUsers.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">Пользователи не найдены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map((user, index) => (
            <UserRow
              key={user.id}
              user={user}
              index={index}
              isSelf={currentUser?.id === user.id}
              onEdit={setEditUser}
              onToggle={toggleActive}
              onDelete={setDeleteUser}
            />
          ))}
        </div>
      )}

      <CreateUserDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmit={create}
      />
      <EditUserDialog
        open={editUser !== null}
        user={editUser}
        onOpenChange={(open) => !open && setEditUser(null)}
        onSubmit={update}
      />
      <DeleteUserDialog
        open={deleteUser !== null}
        user={deleteUser}
        onOpenChange={(open) => !open && setDeleteUser(null)}
        onConfirm={remove}
      />
    </div>
  );
}
