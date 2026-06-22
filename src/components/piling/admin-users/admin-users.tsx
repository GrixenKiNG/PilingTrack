'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  HardHat,
  Link2Off,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePilingStore } from '@/lib/store';
import { ROLE_LABELS, type OperationalUserDTO } from '@/lib/types';
import { pluralizeRu } from '@/lib/format';
import {
  OpsPage,
  OpsHeader,
  OpsKpiBar,
  OpsFilterBar,
  OpsTable,
  OpsTableEmpty,
  OpsDetailEmpty,
  OpsRiskBadge,
  resolveRisk,
  type OpsColumn,
  type OpsQuickFilter,
} from '@/components/piling/ops-shell';
import { useUsersList } from './use-users-list';
import { CreateUserDialog, EditUserDialog, DeleteUserDialog } from './user-dialogs';
import {
  computeUserKpis,
  filterOperationalUsers,
  type UserQuickFilter,
} from './user-list-model';
import { UserDetail } from './user-detail';

const QUICK_FILTERS: OpsQuickFilter<UserQuickFilter>[] = [
  { key: 'all', label: 'Все' },
  { key: 'operators', label: 'Операторы' },
  { key: 'assistants', label: 'Помощники' },
  { key: 'dispatchers', label: 'Диспетчеры' },
  { key: 'admins', label: 'Администраторы' },
  { key: 'blocked', label: 'Заблокированные' },
  { key: 'no-site', label: 'Без объекта' },
  { key: 'no-crew', label: 'Без бригады' },
  { key: 'inactive-30-days', label: 'Нет активности 30 дней' },
];

const KPI_ICONS = {
  'Всего': Users,
  'Активные': UserCheck,
  'Операторы': HardHat,
  'Без закрепления': Link2Off,
  'Заблокированы': AlertTriangle,
} as const;

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function userRisk(user: OperationalUserDTO) {
  return resolveRisk([[!user.isActive, 'critical', 'Заблокирован']], 'Активен');
}

function formatActivity(user: OperationalUserDTO) {
  if (!user.lastActivityAt) return { value: 'Нет активности', source: 'Данных пока нет' };
  const source = user.lastActivitySource === 'login'
    ? 'Вход'
    : user.lastActivitySource === 'report'
      ? 'Отчёт'
      : 'Профиль';
  return { value: dateTimeFormatter.format(new Date(user.lastActivityAt)), source };
}

export function AdminUsers() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const { users, loading, error, retry, create, update, remove, toggleActive } = useUsersList();
  const [quick, setQuick] = useState<UserQuickFilter>('all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<OperationalUserDTO | null>(null);
  const [deleteUser, setDeleteUser] = useState<OperationalUserDTO | null>(null);

  const filtered = useMemo(() => filterOperationalUsers(users, {
    quick,
    search,
    now: new Date(),
  }), [users, quick, search]);

  const active = useMemo(
    () => filtered.find((user) => user.id === activeId) ?? filtered[0] ?? null,
    [filtered, activeId]
  );

  const kpis = useMemo(() => computeUserKpis(users).map((item) => ({
    ...item,
    icon: KPI_ICONS[item.label as keyof typeof KPI_ICONS] ?? ShieldCheck,
  })), [users]);

  const columns = useMemo<OpsColumn<OperationalUserDTO>[]>(() => [
    {
      key: 'name',
      header: 'Пользователь',
      width: 'minmax(155px,1.35fr)',
      cell: (user) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-950">{user.name}</div>
          <div className="mt-0.5 truncate text-2xs text-slate-400">{user.email}</div>
          {user.phone && <div className="truncate text-3xs text-slate-400">{user.phone}</div>}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      width: '100px',
      cell: (user) => <span className="text-xs text-slate-700">{ROLE_LABELS[user.role]}</span>,
    },
    {
      key: 'site',
      header: 'Объект',
      width: 'minmax(105px,0.9fr)',
      cell: (user) => user.assignedSites.length > 0 ? (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-slate-800">{user.assignedSites[0]?.name}</div>
          {user.assignedSites.length > 1 && (
            <div className="text-3xs text-slate-400">+ ещё {user.assignedSites.length - 1}</div>
          )}
        </div>
      ) : <span className="text-2xs text-amber-600">Не назначен</span>,
    },
    {
      key: 'crew',
      header: 'Бригада / установка',
      width: 'minmax(130px,1.1fr)',
      cell: (user) => user.activeCrew ? (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-slate-800">{user.activeCrew.name || 'Экипаж'}</div>
          <div className="truncate text-3xs text-slate-400">{user.activeCrew.equipmentName || 'Без установки'}</div>
        </div>
      ) : <span className="text-2xs text-amber-600">Не назначена</span>,
    },
    {
      key: 'activity',
      header: 'Активность',
      width: '112px',
      cell: (user) => {
        const activity = formatActivity(user);
        return (
          <div>
            <div className="text-2xs font-medium text-slate-700">{activity.value}</div>
            <div className="text-3xs text-slate-400">{activity.source}</div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Статус',
      width: '92px',
      cell: (user) => {
        const risk = userRisk(user);
        return <OpsRiskBadge level={risk.level} label={risk.label} />;
      },
    },
  ], []);

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-72 place-items-center p-6 text-center">
        <div>
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="text-sm font-semibold text-slate-900">Не удалось загрузить пользователей</p>
          <p className="mt-1 text-xs text-slate-500">{error}</p>
          <Button variant="outline" onClick={retry} className="mt-4">
            <RefreshCw className="h-4 w-4" /> Повторить
          </Button>
        </div>
      </div>
    );
  }

  const header = (
    <OpsHeader
      icon={Users}
      title="Пользователи"
      countLabel={`${filtered.length} ${pluralizeRu(filtered.length, ['запись', 'записи', 'записей'])}`}
      subtitle="Доступы, закрепления и фактическая активность сотрудников"
      actions={
        <Button onClick={() => setShowCreate(true)} className="h-10 bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="h-4 w-4" />Новый пользователь
        </Button>
      }
    />
  );

  return (
    <>
      <OpsPage
        layout="wideMain"
        header={header}
        aside={active ? (
          <UserDetail
            user={active}
            isSelf={currentUser?.id === active.id}
            onEdit={() => setEditUser(active)}
            onDelete={() => setDeleteUser(active)}
            onToggle={() => toggleActive(active)}
          />
        ) : <OpsDetailEmpty message="Выберите пользователя, чтобы увидеть доступы и историю." />}
      >
        <OpsKpiBar items={kpis} />
        <OpsFilterBar
          quickFilters={QUICK_FILTERS}
          active={quick}
          onSelect={setQuick}
          extra={(
            <label className="relative block w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ФИО, email или телефон"
                aria-label="Поиск пользователей"
                className="h-9 pl-9 text-xs"
              />
            </label>
          )}
          footer={`Показано ${filtered.length} из ${users.length}`}
        />
        <OpsTable
          columns={columns}
          rows={filtered}
          getRowId={(user) => user.id}
          activeId={active?.id ?? null}
          onRowSelect={(user) => setActiveId(user.id)}
          empty={<OpsTableEmpty icon={Users} title="Пользователи не найдены" hint="Измените фильтр или строку поиска." />}
        />
      </OpsPage>

      <CreateUserDialog open={showCreate} onOpenChange={setShowCreate} onSubmit={create} />
      <EditUserDialog open={editUser !== null} user={editUser} onOpenChange={(open) => !open && setEditUser(null)} onSubmit={update} />
      <DeleteUserDialog open={deleteUser !== null} user={deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)} onConfirm={remove} />
    </>
  );
}
