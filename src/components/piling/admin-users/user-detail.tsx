'use client';

import { Pencil, Power, PowerOff, Trash2 } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ROLE_LABELS, type OperationalUserDTO } from '@/lib/types';
import {
  OpsDetailPanel,
  OpsFact,
  OpsHistoryList,
  OpsRiskBadge,
  resolveRisk,
  useEntityHistory,
} from '@/components/piling/ops-shell';

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string | null) {
  return value ? dateTimeFormatter.format(new Date(value)) : 'Нет данных';
}

function activitySource(source: OperationalUserDTO['lastActivitySource']) {
  if (source === 'login') return 'Вход в систему';
  if (source === 'report') return 'Сменный отчёт';
  if (source === 'profile') return 'Изменение профиля';
  return 'Нет данных';
}

interface UserDetailProps {
  user: OperationalUserDTO;
  isSelf: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}

export function UserDetail({ user, isSelf, onEdit, onDelete, onToggle }: UserDetailProps) {
  const risk = resolveRisk([[!user.isActive, 'critical', 'Заблокирован']], 'Активен');
  const history = useEntityHistory('users', user.id);

  return (
    <OpsDetailPanel
      title={user.name}
      subtitle={ROLE_LABELS[user.role]}
      status={<OpsRiskBadge level={risk.level} label={risk.label} />}
    >
      <Tabs defaultValue="overview" className="gap-3">
        <TabsList className="grid h-auto w-full grid-cols-5 rounded-md bg-slate-100 p-1">
          <TabsTrigger value="overview" className="min-w-0 px-1 text-3xs">Обзор</TabsTrigger>
          <TabsTrigger value="assignment" className="min-w-0 px-1 text-3xs">Закрепление</TabsTrigger>
          <TabsTrigger value="activity" className="min-w-0 px-1 text-3xs">Активность</TabsTrigger>
          <TabsTrigger value="access" className="min-w-0 px-1 text-3xs">Доступ</TabsTrigger>
          <TabsTrigger value="history" className="min-w-0 px-1 text-3xs">История</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-2">
          <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
            <OpsFact label="Email" value={user.email} />
            <OpsFact label="Телефон" value={user.phone || 'Не указан'} />
          </div>
          <div className="grid grid-cols-3 divide-x rounded-md border border-slate-200">
            <OpsFact label="Роль" value={ROLE_LABELS[user.role]} />
            <OpsFact label="Отчёты" value={String(user.reportCount)} />
            <OpsFact label="Создан" value={formatDate(user.createdAt)} />
          </div>
        </TabsContent>

        <TabsContent value="assignment" className="space-y-2">
          <div className="rounded-md border border-slate-200">
            <div className="border-b border-slate-100 px-2.5 py-2 text-2xs font-semibold text-slate-700">Объекты</div>
            {user.assignedSites.length > 0 ? user.assignedSites.map((site) => (
              <div key={site.id} className="border-b border-slate-100 px-2.5 py-2 text-xs last:border-b-0">{site.name}</div>
            )) : <div className="px-2.5 py-3 text-2xs text-amber-600">Объект не назначен</div>}
          </div>
          <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200 bg-slate-50">
            <OpsFact label="Бригада" value={user.activeCrew?.name || 'Не назначена'} />
            <OpsFact label="Установка" value={user.activeCrew?.equipmentName || 'Не назначена'} />
          </div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-2">
          <div className="grid grid-cols-2 divide-x rounded-md border border-slate-200">
            <OpsFact label="Последний вход" value={formatDate(user.lastLoginAt)} />
            <OpsFact label="Последний отчёт" value={formatDate(user.lastReportAt)} />
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50">
            <OpsFact
              label="Последняя активность"
              value={formatDate(user.lastActivityAt)}
              sub={activitySource(user.lastActivitySource)}
            />
          </div>
        </TabsContent>

        <TabsContent value="access" className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit} className="h-8 text-xs">
              <Pencil className="h-3.5 w-3.5" />Редактировать
            </Button>
            {!isSelf && (
              <Button size="sm" variant="outline" onClick={onToggle} className="h-8 text-xs">
                {user.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                {user.isActive ? 'Заблокировать' : 'Разблокировать'}
              </Button>
            )}
            {!isSelf && user.canHardDelete && (
              <Button size="sm" variant="outline" onClick={onDelete} className="h-8 text-xs text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />Удалить
              </Button>
            )}
          </div>
          {!user.canHardDelete && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-2xs text-amber-800">
              У пользователя есть отчёты или закрепления. Доступно только блокирование.
            </p>
          )}
        </TabsContent>

        <TabsContent value="history">
          <OpsHistoryList entries={history.entries} loading={history.loading} error={history.error} title="История изменений" />
        </TabsContent>
      </Tabs>
    </OpsDetailPanel>
  );
}
