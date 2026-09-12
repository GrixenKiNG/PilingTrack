'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileText,
  HardHat,
  Link2Off,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from '@/components/piling/icons/unified-icons';
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
import { UserDocumentTypesDialog } from './user-document-types-dialog';
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
  'Доступ включён': UserCheck,
  'Операторы': HardHat,
  'Требуют закрепления': Link2Off,
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
  return resolveRisk([[!user.isActive, 'critical', 'Заблокирован']], 'Доступ включён');
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

/**
 * Фильтр, поиск и выбранный сотрудник живут в адресе страницы.
 *
 * Без этого перезагрузка (или переход по ссылке коллеге) возвращала пустой
 * список «Все» с начала: администратор, разбиравший операторов без бригады,
 * каждый раз набирал фильтр заново.
 */
const QUICK_KEYS: UserQuickFilter[] = [
  'all', 'operators', 'dispatchers', 'admins', 'assistants',
  'blocked', 'no-site', 'no-crew', 'inactive-30-days',
];

function readUrlState(search: string) {
  const params = new URLSearchParams(search);
  const quick = params.get('filter');
  return {
    quick: QUICK_KEYS.includes(quick as UserQuickFilter) ? (quick as UserQuickFilter) : 'all',
    search: params.get('q') ?? '',
    userId: params.get('userId'),
  };
}

function writeUrlState(state: { quick: UserQuickFilter; search: string; userId: string | null }) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const pairs: Record<string, string> = {
    filter: state.quick === 'all' ? '' : state.quick,
    q: state.search,
    userId: state.userId ?? '',
  };
  Object.entries(pairs).forEach(([key, value]) =>
    value ? url.searchParams.set(key, value) : url.searchParams.delete(key));
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
}

export function AdminUsers() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const { users, loading, error, retry, create, update, remove, toggleActive } = useUsersList();
  const initial = useMemo(
    () => readUrlState(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );
  const [quick, setQuick] = useState<UserQuickFilter>(initial.quick);
  const [search, setSearch] = useState(initial.search);
  const [activeId, setActiveId] = useState<string | null>(initial.userId);
  const [showCreate, setShowCreate] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
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

  useEffect(() => {
    writeUrlState({ quick, search, userId: active?.id ?? null });
  }, [quick, search, active?.id]);

  /**
   * На телефоне карточка стоит под всем списком: после выбора сотрудника она
   * оказывалась почти на три тысячи точек ниже экрана, и человек не понимал,
   * что вообще что-то произошло. На широком экране панель и так рядом.
   */
  const selectUser = (id: string) => {
    setActiveId(id);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches) {
      requestAnimationFrame(() =>
        document.getElementById('user-detail-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  };

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
          <div className="truncate font-medium text-foreground">{user.name}</div>
          <div className="mt-0.5 truncate text-2xs text-muted-foreground">{user.email}</div>
          {user.phone && <div className="truncate text-3xs text-muted-foreground">{user.phone}</div>}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Роль',
      width: '100px',
      cell: (user) => <span className="text-xs text-foreground">{ROLE_LABELS[user.role]}</span>,
    },
    {
      key: 'site',
      header: 'Объект',
      width: 'minmax(105px,0.9fr)',
      cell: (user) => user.assignedSites.length > 0 ? (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{user.assignedSites[0]?.name}</div>
          {user.assignedSites.length > 1 && (
            <div className="text-3xs text-muted-foreground">+ ещё {user.assignedSites.length - 1}</div>
          )}
        </div>
      ) : user.role === 'ASSISTANT' && user.activeCrew?.siteName ? (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{user.activeCrew.siteName}</div>
          <div className="text-3xs text-muted-foreground">Через экипаж</div>
        </div>
      ) : <span className="text-2xs text-warning-strong">Не назначен</span>,
    },
    {
      key: 'crew',
      header: 'Бригада / установка',
      width: 'minmax(130px,1.1fr)',
      cell: (user) => user.activeCrew ? (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{user.activeCrew.name || 'Экипаж'}</div>
          <div className="truncate text-3xs text-muted-foreground">{user.activeCrew.equipmentName || 'Без установки'}</div>
        </div>
      ) : <span className="text-2xs text-warning-strong">Не назначена</span>,
    },
    {
      key: 'activity',
      header: 'Активность',
      width: '112px',
      cell: (user) => {
        const activity = formatActivity(user);
        return (
          <div>
            <div className="text-2xs font-medium text-foreground">{activity.value}</div>
            <div className="text-3xs text-muted-foreground">{activity.source}</div>
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
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive-strong" />
          <p className="text-sm font-semibold text-foreground">Не удалось загрузить пользователей</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
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
        <div className="flex flex-wrap gap-2">
          {/* Справочник видов документов живёт здесь, а не в «Справочниках»:
              там перечни свайных работ (марки свай, типы бурения, причины
              простоя), а это перечень про людей и он нужен рядом с ними. */}
          <Button variant="outline" className="h-10" onClick={() => setShowTypes(true)}>
            <FileText className="h-4 w-4" />Виды документов
          </Button>
          <Button onClick={() => setShowCreate(true)} className="h-10 bg-signal text-white hover:bg-signal-strong">
            <Plus className="h-4 w-4" />Новый пользователь
          </Button>
        </div>
      }
    />
  );

  return (
    <>
      <OpsPage
        header={header}
        kpi={<OpsKpiBar items={kpis} />}
        aside={active ? (
          <div id="user-detail-panel" className="scroll-mt-24">
          <UserDetail
            user={active}
            isSelf={currentUser?.id === active.id}
            onEdit={() => setEditUser(active)}
            onDelete={() => setDeleteUser(active)}
            onToggle={() => toggleActive(active)}
          />
          </div>
        ) : <OpsDetailEmpty message="Выберите пользователя, чтобы увидеть доступы и историю." />}
      >
        <OpsFilterBar
          quickFilters={QUICK_FILTERS}
          active={quick}
          onSelect={setQuick}
          extra={(
            <label className="relative block w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
          onRowSelect={(user) => selectUser(user.id)}
          empty={<OpsTableEmpty icon={Users} title="Пользователи не найдены" hint="Измените фильтр или строку поиска." />}
        />
      </OpsPage>

      <UserDocumentTypesDialog open={showTypes} onOpenChange={setShowTypes} />
      <CreateUserDialog open={showCreate} onOpenChange={setShowCreate} onSubmit={create} />
      <EditUserDialog open={editUser !== null} user={editUser} onOpenChange={(open) => !open && setEditUser(null)} onSubmit={update} />
      <DeleteUserDialog open={deleteUser !== null} user={deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)} onConfirm={remove} />
    </>
  );
}
