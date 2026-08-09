'use client';

import { ForemanIcon, SafetyEngineerIcon } from '@/components/piling/icons';
import { Wrench } from '@/components/piling/icons/unified-icons';
import { ACTING_ROLES, ROLE_LABELS, type ActingRole } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Переключатель исполняемой роли для администратора.
 *
 * В организации пока нет живых механика, мастера и инженера ОТ — их работу
 * делает администратор. Раньше режим механика включался автоматически и
 * невидимо: администратор просто получал его права, не зная об этом, а в
 * журнале действие подписывалось «действует за механика». Теперь роль
 * выбирается явно, и видно, от чьего имени идёт запись.
 *
 * Когда роль получит живого человека, переключатель ничего не сломает:
 * права придут к нему из его собственной учётной записи.
 */
interface ActingRoleSwitchProps {
  actorRole: string;
  value: ActingRole | null;
  onChange: (value: ActingRole | null) => void;
  disabled?: boolean;
}

/** Все три — контурные иконки одной грамматики, чтобы ряд читался как ряд. */
const ROLE_ICON: Record<ActingRole, (props: { className?: string }) => React.ReactElement> = {
  MECHANIC: (props) => <Wrench {...props} />,
  FOREMAN: (props) => <ForemanIcon {...props} />,
  SAFETY_ENGINEER: (props) => <SafetyEngineerIcon {...props} />,
};

export function ActingRoleSwitch({ actorRole, value, onChange, disabled = false }: ActingRoleSwitchProps) {
  // Исполнять чужую роль может только администратор — то же правило, что и на
  // сервере (`canActAs`). Остальным контрол не показываем совсем, чтобы не
  // предлагать действие, которое закончится отказом.
  if (actorRole !== 'ADMIN') return null;

  const Icon = value ? ROLE_ICON[value] : null;

  return (
    <label className="flex shrink-0 items-center gap-2 pl-3 pr-1 text-xs">
      <span className="hidden text-muted-foreground sm:inline">Действую как</span>
      {Icon && <Icon className="h-4 w-4 shrink-0 text-signal-strong" aria-hidden="true" />}
      <select
        value={value ?? 'ADMIN'}
        disabled={disabled}
        aria-label="Роль, от имени которой вы работаете"
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === 'ADMIN' ? null : (next as ActingRole));
        }}
        className={cn(
          'min-h-9 rounded-md border border-border bg-card px-2 text-xs font-medium text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-60',
          value && 'border-signal/40 text-signal-strong',
        )}
      >
        <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
        {ACTING_ROLES.map((role) => (
          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
        ))}
      </select>
    </label>
  );
}
