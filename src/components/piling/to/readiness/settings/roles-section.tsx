'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, ChevronRight } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  READINESS_ABILITIES,
  type ReadinessAbility,
  type ReadinessRole,
  resolveReadinessCapabilities,
} from '@/modules/readiness/application/capabilities';
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

interface RolesSettingsProps {
  bootstrap: ReadinessBootstrap | null;
}

export function RolesSettings({ bootstrap }: RolesSettingsProps) {
  const actors = bootstrap?.selectors.actors ?? [];
  const [selectedRole, setSelectedRole] = useState<string>(bootstrap?.actor.role ?? 'DISPATCHER');

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

  const abilitiesByRole = new Map(MATRIX_ROLES.map((role) => [role, resolveReadinessCapabilities(role)]));
  const selectedUsers = byRole.get(selectedRole) ?? [];

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
        { icon: 'users', label: 'Ваша роль', value: handoverRoleLabel(bootstrap?.actor.actingAs ?? bootstrap?.actor.role ?? null) ?? '—' },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-hidden')}>
          <div className="border-b border-border p-4">
            <h2 className="font-bold">Матрица полномочий</h2>
            <p className="mt-1 text-xs text-muted-foreground">Что роль может сделать в модуле. Ровно те правила, по которым сервер пропускает или отклоняет команду.</p>
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
                {MATRIX_ROLES.map((role) => (
                  <span key={role} className="flex justify-center">
                    {abilitiesByRole.get(role)?.has(ability)
                      ? <CheckCircle2 className="h-4 w-4 text-success-strong" aria-label={`${handoverRoleLabel(role)}: разрешено`} />
                      : <span className="text-muted-foreground" aria-label={`${handoverRoleLabel(role)}: недоступно`}>—</span>}
                  </span>
                ))}
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
              {selectedUsers.map((user) => (
                <Link key={user.id} href="/admin/users" className="flex min-h-11 items-center gap-3 px-4 py-2 text-xs hover:bg-signal/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal">
                  <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-3xs font-bold text-muted-foreground">{(user.name || '?').slice(0, 1).toLocaleUpperCase('ru-RU')}</span>
                  <span className="min-w-0 flex-1 truncate">{user.name || 'Без имени'}</span>
                  <StatusPill tone="success">Активен</StatusPill>
                </Link>
              ))}
              {selectedUsers.length === 0 && <div className="p-6 text-center text-xs text-muted-foreground">В этой роли нет действующих пользователей.</div>}
            </div>
            <div className="border-t border-border p-3">
              <Button asChild variant="outline" className="w-full"><Link href="/admin/users">Добавить пользователя</Link></Button>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
