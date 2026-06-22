import type { OperationalUserDTO } from '@/lib/types';
import type { OpsKpiItem } from '@/components/piling/ops-shell/types';

export type UserQuickFilter =
  | 'all'
  | 'operators'
  | 'dispatchers'
  | 'admins'
  | 'assistants'
  | 'blocked'
  | 'no-site'
  | 'no-crew'
  | 'inactive-30-days';

export interface OperationalUserFilters {
  quick: UserQuickFilter;
  search: string;
  now: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

function isInactiveForThirtyDays(user: OperationalUserDTO, now: Date): boolean {
  const source = user.lastActivityAt ?? user.createdAt;
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) && timestamp < now.getTime() - THIRTY_DAYS_MS;
}

function matchesQuickFilter(user: OperationalUserDTO, quick: UserQuickFilter, now: Date): boolean {
  switch (quick) {
    case 'operators': return user.role === 'OPERATOR';
    case 'dispatchers': return user.role === 'DISPATCHER';
    case 'admins': return user.role === 'ADMIN';
    case 'assistants': return user.role === 'ASSISTANT';
    case 'blocked': return !user.isActive;
    case 'no-site': return user.assignedSites.length === 0;
    case 'no-crew': return user.activeCrew === null;
    case 'inactive-30-days': return isInactiveForThirtyDays(user, now);
    case 'all': return true;
  }
}

export function filterOperationalUsers(
  users: OperationalUserDTO[],
  filters: OperationalUserFilters
): OperationalUserDTO[] {
  const search = filters.search.trim().toLocaleLowerCase('ru');

  return users.filter((user) => {
    if (!matchesQuickFilter(user, filters.quick, filters.now)) return false;
    if (!search) return true;

    return [user.name, user.email, user.phone]
      .some((value) => value.toLocaleLowerCase('ru').includes(search));
  });
}

export function computeUserKpis(users: OperationalUserDTO[]): OpsKpiItem[] {
  const active = users.filter((user) => user.isActive).length;
  const operators = users.filter((user) => user.role === 'OPERATOR').length;
  const withoutAssignment = users.filter(
    (user) => user.assignedSites.length === 0 || user.activeCrew === null
  ).length;
  const blocked = users.length - active;

  return [
    { label: 'Всего', value: String(users.length), detail: 'учётных записей', tone: 'slate' },
    { label: 'Активные', value: String(active), detail: 'имеют доступ', tone: 'emerald' },
    { label: 'Операторы', value: String(operators), detail: 'машинисты', tone: 'blue' },
    {
      label: 'Без закрепления',
      value: String(withoutAssignment),
      detail: 'объект или бригада',
      tone: withoutAssignment > 0 ? 'amber' : 'slate',
    },
    {
      label: 'Заблокированы',
      value: String(blocked),
      detail: 'без доступа',
      tone: blocked > 0 ? 'red' : 'slate',
    },
  ];
}
