'use client';

import { useMemo, useState } from 'react';
import { Users, UserCheck, UserCog, ShieldCheck, Plus, Pencil, Trash2, Power, PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePilingStore } from '@/lib/store';
import { ROLE_LABELS, type UserDTO } from '@/lib/types';
import { pluralizeRu } from '@/lib/format';
import {
  OpsPage,
  OpsHeader,
  OpsKpiBar,
  OpsFilterBar,
  OpsTable,
  OpsTableEmpty,
  OpsDetailPanel,
  OpsDetailEmpty,
  OpsFact,
  OpsHistoryList,
  OpsRiskBadge,
  resolveRisk,
  useEntityHistory,
  type OpsColumn,
  type OpsQuickFilter,
  type OpsKpiItem,
} from '@/components/piling/ops-shell';
import { useUsersList } from './use-users-list';
import { CreateUserDialog, EditUserDialog, DeleteUserDialog } from './user-dialogs';

type QuickKey = 'all' | 'operators' | 'dispatchers' | 'admins' | 'blocked';

const QUICK_FILTERS: OpsQuickFilter<QuickKey>[] = [
  { key: 'all', label: 'Все' },
  { key: 'operators', label: 'Операторы' },
  { key: 'dispatchers', label: 'Диспетчеры' },
  { key: 'admins', label: 'Администраторы' },
  { key: 'blocked', label: 'Заблокированные' },
];

function userRisk(user: UserDTO) {
  return resolveRisk([[!user.isActive, 'critical', 'Заблокирован']], 'Активен');
}

export function AdminUsers() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const { users, loading, create, update, remove, toggleActive } = useUsersList();

  const [quick, setQuick] = useState<QuickKey>('all');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<UserDTO | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserDTO | null>(null);

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (quick === 'operators') return u.role === 'OPERATOR';
      if (quick === 'dispatchers') return u.role === 'DISPATCHER';
      if (quick === 'admins') return u.role === 'ADMIN';
      if (quick === 'blocked') return !u.isActive;
      return true;
    });
  }, [users, quick]);

  const active = useMemo(
    () => filtered.find((u) => u.id === activeId) ?? filtered[0] ?? null,
    [filtered, activeId],
  );

  const kpis: OpsKpiItem[] = useMemo(() => {
    const activeCount = users.filter((u) => u.isActive).length;
    const operators = users.filter((u) => u.role === 'OPERATOR').length;
    const dispatchers = users.filter((u) => u.role === 'DISPATCHER').length;
    const blocked = users.filter((u) => !u.isActive).length;
    return [
      { label: 'Всего', value: String(users.length), detail: 'учётных записей', icon: Users, tone: 'slate' },
      { label: 'Активные', value: String(activeCount), detail: 'имеют доступ', icon: UserCheck, tone: 'emerald' },
      { label: 'Операторы', value: String(operators), detail: 'машинисты', icon: UserCog, tone: 'blue' },
      { label: 'Диспетчеры', value: String(dispatchers), detail: 'контроль', icon: ShieldCheck, tone: 'slate' },
      { label: 'Заблокир.', value: String(blocked), detail: 'без доступа', icon: Users, tone: blocked > 0 ? 'red' : 'slate' },
    ];
  }, [users]);

  const columns: OpsColumn<UserDTO>[] = [
    {
      key: 'name',
      header: 'ФИО',
      width: 'minmax(180px,1.6fr)',
      cell: (u) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-950">{u.name}</div>
          <div className="mt-0.5 truncate text-2xs text-slate-400">{u.email}</div>
        </div>
      ),
    },
    { key: 'role', header: 'Роль', width: 'minmax(120px,1fr)', cell: (u) => <span className="text-slate-700">{ROLE_LABELS[u.role]}</span> },
    {
      key: 'status',
      header: 'Статус',
      width: '120px',
      cell: (u) => {
        const risk = userRisk(u);
        return <OpsRiskBadge level={risk.level} label={risk.label} />;
      },
    },
  ];

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  const header = (
    <OpsHeader
      icon={Users}
      title="Пользователи"
      countLabel={`${filtered.length} ${pluralizeRu(filtered.length, ['запись', 'записи', 'записей'])}`}
      subtitle="Доступы и активность: роли, статус, история изменений"
      actions={
        <Button onClick={() => setShowCreate(true)} className="h-10 bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="mr-1.5 h-4 w-4" />Новый пользователь
        </Button>
      }
    />
  );

  return (
    <>
      <OpsPage
        header={header}
        aside={active
          ? (
            <UserDetail
              user={active}
              isSelf={currentUser?.id === active.id}
              onEdit={() => setEditUser(active)}
              onDelete={() => setDeleteUser(active)}
              onToggle={() => toggleActive(active)}
            />
          )
          : <OpsDetailEmpty message="Выберите пользователя, чтобы увидеть доступы и историю." />}
      >
        <OpsKpiBar items={kpis} />
        <OpsFilterBar quickFilters={QUICK_FILTERS} active={quick} onSelect={setQuick} footer={`Показано ${filtered.length} из ${users.length}`} />
        <OpsTable
          columns={columns}
          rows={filtered}
          getRowId={(u) => u.id}
          activeId={active?.id ?? null}
          onRowSelect={(u) => setActiveId(u.id)}
          empty={<OpsTableEmpty icon={Users} title="Пользователи не найдены" hint="Измените фильтр или создайте запись." />}
        />
      </OpsPage>

      <CreateUserDialog open={showCreate} onOpenChange={setShowCreate} onSubmit={create} />
      <EditUserDialog open={editUser !== null} user={editUser} onOpenChange={(open) => !open && setEditUser(null)} onSubmit={update} />
      <DeleteUserDialog open={deleteUser !== null} user={deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)} onConfirm={remove} />
    </>
  );
}

function UserDetail({ user, isSelf, onEdit, onDelete, onToggle }: { user: UserDTO; isSelf: boolean; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
  const risk = userRisk(user);
  const history = useEntityHistory('users', user.id);
  return (
    <OpsDetailPanel title={user.name} subtitle={ROLE_LABELS[user.role]} status={<OpsRiskBadge level={risk.level} label={risk.label} />}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} className="h-8 text-xs"><Pencil className="mr-1 h-3.5 w-3.5" />Редактировать</Button>
        {!isSelf && (
          <>
            <Button size="sm" variant="outline" onClick={onToggle} className="h-8 text-xs">
              {user.isActive ? <PowerOff className="mr-1 h-3.5 w-3.5" /> : <Power className="mr-1 h-3.5 w-3.5" />}
              {user.isActive ? 'Заблокировать' : 'Разблокировать'}
            </Button>
            <Button size="sm" variant="outline" onClick={onDelete} className="h-8 text-xs text-red-600 hover:bg-red-50"><Trash2 className="mr-1 h-3.5 w-3.5" />Удалить</Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
        <OpsFact label="Email" value={user.email} />
        <OpsFact label="Роль" value={ROLE_LABELS[user.role]} />
      </div>
      <div className="grid grid-cols-1 rounded-md border border-slate-200">
        <OpsFact label="Доступ" value={user.isActive ? 'Активен' : 'Заблокирован'} />
      </div>

      <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title="История изменений" />
    </OpsDetailPanel>
  );
}
