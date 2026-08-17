'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronRight } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { pluralizeRu } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  READINESS_ABILITIES,
  type ReadinessAbility,
  type ReadinessRole,
  resolveReadinessCapabilities,
} from '@/modules/readiness/application/capabilities';
import type { AccessMatrixState } from '@/modules/readiness/application/access-matrix-service';
import type { ReadinessBootstrap } from '../api/contracts';
import { handoverRoleLabel } from '../handover-journal';
import { ScreenTitle, SettingsKpis, StatusPill, card } from './shared-ui';

/**
 * Матрица строится из того же источника, что и серверная проверка прав
 * (`resolveReadinessCapabilities`), поэтому расходиться с реальностью не может.
 */
const MATRIX_ROLES: ReadinessRole[] = [
  'OPERATOR', 'ASSISTANT', 'DISPATCHER', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER', 'ADMIN',
];

const ABILITY_LABEL: Record<ReadinessAbility, string> = {
  'readiness.read': 'Видеть модуль',
  'readiness.shift.manage': 'Вести смену',
  'readiness.handover.prepare': 'Готовить передачу',
  'readiness.handover.decide': 'Допускать и принимать смену',
  'readiness.inspection.manage': 'Проводить осмотр',
  'readiness.defect.report': 'Фиксировать замечание',
  'readiness.defect.manage': 'Разбирать и закрывать дефекты',
  'readiness.meter.manage': 'Подтверждать моточасы',
  'readiness.maintenance.manage': 'Вести обслуживание',
  'readiness.permit.edit': 'Готовить наряд-допуск',
  'readiness.permit.approve_dispatcher': 'Согласовывать наряд (диспетчер)',
  'readiness.permit.approve_admin': 'Согласовывать наряд (администратор)',
  'readiness.rules.manage': 'Изменять правила готовности',
  'readiness.audit.read': 'Читать журнал аудита',
  'readiness.audit.export': 'Выгружать журнал аудита',
};

/**
 * Роли, которым объекты не назначают: у них есть `sites.read_all`, и проверка
 * `assertCanAccessSite` пропускает их до обращения к назначениям
 * (`resource-access-service.ts`). Для остальных пустой список назначений — это
 * не «все объекты», а ни одного: пользователь не откроет ни одну площадку.
 */
const UNSCOPED_ROLES = new Set(['ADMIN', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER']);

/**
 * Форма из `listUsers` (`services/users/user-service.ts`): назначенные объекты
 * приходят полем `assignedSites`, уже развёрнутым в площадки. Связь в базе
 * называется `sites` и хранит промежуточные записи — на неё легко ошибиться,
 * и тогда объекты не найдутся ни у кого.
 */
interface DirectoryUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  assignedSites?: Array<{ id: string; name: string }>;
}

interface RolesSettingsProps {
  bootstrap: ReadinessBootstrap | null;
}

export function RolesSettings({ bootstrap }: RolesSettingsProps) {
  const actors = bootstrap?.selectors.actors ?? [];
  const [selectedRole, setSelectedRole] = useState<string>(bootstrap?.actor.role ?? 'DISPATCHER');
  // Контур доступа приходит только из справочника пользователей: в bootstrap
  // лежат id, имя и роль. Право `users.manage` есть не у всех, кому открыт
  // раздел, — на отказ просто не показываем колонку.
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null);
  const [state, setState] = useState<AccessMatrixState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void authFetch('/api/readiness/access-matrix')
      .then(async (response) => {
        // 403 у роли без права настраивать — раздел остаётся «только смотреть».
        if (!response.ok) return;
        const body = await response.json() as { data?: AccessMatrixState };
        if (active && body.data) setState(body.data);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void authFetch('/api/users?limit=100')
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { users?: DirectoryUser[] };
        if (active && Array.isArray(body.users)) setDirectory(body.users);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const scopeById = new Map((directory ?? []).map((user) => [user.id, user]));
  const scopeOf = (userId: string, role: string) => {
    if (UNSCOPED_ROLES.has(role)) return { label: 'Все объекты', tone: 'neutral' as const };
    if (!directory) return { label: '—', tone: 'neutral' as const };
    const sites = scopeById.get(userId)?.assignedSites ?? [];
    if (sites.length === 0) return { label: 'Объекты не назначены', tone: 'warning' as const };
    if (sites.length <= 2) return { label: sites.map((item) => item.name).join(', '), tone: 'info' as const };
    return { label: `${sites.length} ${pluralizeRu(sites.length, ['объект', 'объекта', 'объектов'])}`, tone: 'info' as const };
  };

  // Пользователь без назначений и без права видеть все объекты не откроет ни
  // одной площадки — это настоящая дыра в настройке, а не косметика.
  const lockedOut = (directory ?? []).filter((user) =>
    user.isActive && !UNSCOPED_ROLES.has(user.role) && (user.assignedSites?.length ?? 0) === 0);

  const byRole = new Map<string, typeof actors>();
  for (const actor of actors) {
    byRole.set(actor.role, [...(byRole.get(actor.role) ?? []), actor]);
  }
  const roleRows = MATRIX_ROLES
    .map((role) => ({ role, users: byRole.get(role) ?? [] }))
    // Роли, которых нет в контуре, всё равно показываем: матрица описывает
    // правила модуля, а не текущий состав людей.
    .concat([...byRole.keys()]
      .filter((role) => !MATRIX_ROLES.includes(role as ReadinessRole))
      .map((role) => ({ role: role as ReadinessRole, users: byRole.get(role) ?? [] })));

  // Матрица правится в черновике и применяется публикацией — тот же приём, что
  // у правил готовности. Пока состояние не загружено, показываем значения из
  // кода: они же действуют на сервере, если организация ничего не публиковала.
  const grants = state?.draft?.grants ?? state?.published.grants ?? null;
  const abilitiesByRole = new Map(MATRIX_ROLES.map((role) => [
    role,
    grants ? new Set(grants[role] ?? []) : resolveReadinessCapabilities(role),
  ]));
  const selectedUsers = byRole.get(selectedRole) ?? [];
  const canEdit = bootstrap?.capabilities.entities.rules.manage === true;

  const toggle = async (role: ReadinessRole, ability: ReadinessAbility) => {
    if (!grants || !canEdit || busy) return;
    const current = new Set(grants[role] ?? []);
    if (current.has(ability)) current.delete(ability); else current.add(ability);
    const next = { ...grants, [role]: [...current] };
    setBusy(true);
    try {
      const response = await authFetch('/api/readiness/access-matrix', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ grants: next }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message ?? 'Не удалось сохранить');
      setState((await response.json()).data as AccessMatrixState);
      toast.success('Сохранено в черновик');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      const response = await authFetch('/api/readiness/access-matrix', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error?.message ?? 'Не удалось опубликовать');
      setState((await response.json()).data as AccessMatrixState);
      toast.success('Матрица опубликована — права применяются сразу');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось опубликовать');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ScreenTitle
        heading="Роли и доступы"
        subtitle="Полномочия ролей в контуре технической готовности"
        actions={<Button asChild className="bg-signal-strong hover:bg-signal-strong"><Link href="/admin/users">Управление пользователями</Link></Button>}
      />
      <SettingsKpis items={[
        { icon: 'crew', label: 'Пользователей', value: actors.length },
        { icon: 'operator', label: 'Ролей в контуре', value: byRole.size },
        { icon: 'settings', label: 'Полномочий модуля', value: READINESS_ABILITIES.length },
        {
          icon: 'risk',
          label: 'Без доступа к объектам',
          value: directory ? lockedOut.length : '…',
          detail: directory && lockedOut.length > 0 ? 'не откроют ни одной площадки' : undefined,
          alert: lockedOut.length > 0,
        },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-hidden')}>
          <div className="border-b border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">Матрица полномочий</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Что роль может сделать в модуле. Ровно те правила, по которым сервер пропускает или отклоняет команду.
                  {canEdit && ' Щелчок по клетке меняет право и сохраняется в черновик.'}
                </p>
              </div>
              {canEdit && state && (
                <div className="flex items-center gap-2">
                  {state.pendingChanges > 0
                    ? <StatusPill tone="warning">Черновик: {state.pendingChanges} {pluralizeRu(state.pendingChanges, ['правка', 'правки', 'правок'])}</StatusPill>
                    : <StatusPill tone={state.publishedInDb ? 'success' : 'neutral'}>
                      {state.publishedInDb ? 'Опубликована' : 'Значения по умолчанию'}
                    </StatusPill>}
                  <Button
                    onClick={() => void publish()}
                    disabled={busy || (state.pendingChanges === 0 && state.publishedInDb)}
                    className="bg-signal-strong hover:bg-signal-strong"
                  >
                    Опубликовать
                  </Button>
                </div>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[820px] grid-cols-[minmax(0,1fr)_repeat(7,90px)] items-end gap-1 border-b border-border px-4 py-2 text-3xs font-semibold text-muted-foreground">
              <span>Полномочие</span>
              {MATRIX_ROLES.map((role) => <span key={role} className="text-center">{handoverRoleLabel(role)}</span>)}
            </div>
            {READINESS_ABILITIES.map((ability) => (
              <div key={ability} className="grid min-w-[820px] grid-cols-[minmax(0,1fr)_repeat(7,90px)] items-center gap-1 border-b border-border px-4 py-2 text-2xs last:border-b-0 hover:bg-signal/5">
                <span className="min-w-0">
                  <span className="block font-medium">{ABILITY_LABEL[ability]}</span>
                  <span className="block font-mono text-3xs text-muted-foreground">{ability}</span>
                </span>
                {MATRIX_ROLES.map((role) => {
                  const allowed = abilitiesByRole.get(role)?.has(ability) ?? false;
                  const mark = allowed
                    ? <CheckCircle2 className="h-4 w-4 text-success-strong" />
                    : <span className="text-muted-foreground">—</span>;
                  if (!canEdit || !grants) {
                    return (
                      <span key={role} className="flex justify-center"
                        aria-label={`${handoverRoleLabel(role)}: ${allowed ? 'разрешено' : 'недоступно'}`}>
                        {mark}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={role}
                      type="button"
                      disabled={busy}
                      onClick={() => void toggle(role, ability)}
                      aria-pressed={allowed}
                      aria-label={`${handoverRoleLabel(role)} — ${ABILITY_LABEL[ability]}: ${allowed ? 'разрешено' : 'недоступно'}`}
                      className="flex min-h-9 items-center justify-center rounded hover:bg-signal/10 disabled:opacity-50"
                    >
                      {mark}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-border p-4 text-3xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-success-strong" />Полный доступ</span>
            <span className="flex items-center gap-1.5"><span>—</span>Нет доступа</span>
            <span className="ml-auto">
              Механик, Мастер и Инженер ОТ — роли, которые пока исполняет администратор:
              он переключается на роль, и действие уходит в журнал от её имени. Как только
              появится человек, ему заводят учётную запись с этой ролью, и права переходят к нему.
            </span>
          </div>
        </section>

        <aside className="space-y-3">
          <section className={cn(card, 'overflow-hidden')}>
            <div className="border-b border-border p-4"><h2 className="font-bold">Роли</h2></div>
            <div className="divide-y divide-border">
              {roleRows.map(({ role, users }) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setSelectedRole(role)}
                  aria-current={role === selectedRole}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 border-l-2 px-4 py-2 text-left text-xs transition',
                    role === selectedRole ? 'border-signal bg-signal/10 font-semibold text-signal-strong' : 'border-transparent hover:bg-muted',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{handoverRoleLabel(role)}</span>
                  <span className="font-mono">{users.length}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
          <section className={cn(card, 'overflow-hidden')}>
            <div className="flex items-center justify-between gap-2 border-b border-border p-4">
              <h2 className="font-bold">Пользователи роли</h2>
              <StatusPill tone="neutral">{handoverRoleLabel(selectedRole)}</StatusPill>
            </div>
            <div className="divide-y divide-border">
              {selectedUsers.map((user) => {
                const scope = scopeOf(user.id, user.role);
                return (
                  <Link key={user.id} href="/admin/users" className="flex min-h-11 items-center gap-3 px-4 py-2 text-xs hover:bg-signal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal">
                    <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-3xs font-bold text-muted-foreground">{(user.name || '?').slice(0, 1).toLocaleUpperCase('ru-RU')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{user.name || 'Без имени'}</span>
                      <span className="mt-0.5 block truncate text-3xs text-muted-foreground">Контур: {scope.label}</span>
                    </span>
                    {scope.tone === 'warning'
                      ? <StatusPill tone="warning">Нет объектов</StatusPill>
                      : <StatusPill tone="success">Активен</StatusPill>}
                  </Link>
                );
              })}
              {selectedUsers.length === 0 && <div className="p-6 text-center text-xs text-muted-foreground">В этой роли нет действующих пользователей.</div>}
            </div>
            {lockedOut.length > 0 && (
              <p className="flex items-start gap-2 border-t border-border bg-warning/10 p-3 text-2xs font-semibold leading-relaxed text-warning-strong">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {lockedOut.length} {pluralizeRu(lockedOut.length, ['пользователь', 'пользователя', 'пользователей'])} без назначенных объектов.
                Роль без права «видеть все объекты» без назначения не откроет ни одной площадки.
              </p>
            )}
            <div className="border-t border-border p-3">
              <Button asChild variant="outline" className="w-full"><Link href="/admin/users">Добавить пользователя</Link></Button>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
