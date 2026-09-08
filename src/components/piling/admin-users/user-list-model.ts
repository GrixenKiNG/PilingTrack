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

/**
 * Последнее действие САМОГО человека: вход в систему или сданный отчёт.
 *
 * `lastActivityAt` для этого не годится — в него входит `updatedAt` профиля,
 * то есть правка карточки администратором. Стоило поправить телефон уволенному
 * оператору, и он переставал числиться неактивным: фильтр «нет активности 30
 * дней» переставал его показывать. Человек не делал ничего, отметку о его
 * «активности» поставил другой.
 */
function lastOwnActionAt(user: OperationalUserDTO): string | null {
  const stamps = [user.lastLoginAt, user.lastReportAt]
    .filter((value): value is string => Boolean(value));
  return stamps.sort().at(-1) ?? null;
}

/**
 * Кому закрепление действительно нужно.
 *
 * Считать «без закрепления» всех подряд — значит вечно держать в счётчике
 * администратора и диспетчера, которым ни объект, ни бригада не положены.
 * Помощник тоже сюда не входит: его связь с бригадой идёт через CrewAssistant,
 * а список читает только бригады машиниста (`Crew.operatorId`), поэтому
 * помощник всегда выглядел бы незакреплённым.
 */
function needsAssignment(user: OperationalUserDTO): boolean {
  return user.role === 'OPERATOR';
}

function isInactiveForThirtyDays(user: OperationalUserDTO, now: Date): boolean {
  const source = lastOwnActionAt(user) ?? user.createdAt;
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) && timestamp < now.getTime() - THIRTY_DAYS_MS;
}

/** Телефон сравниваем по цифрам: «+7-900-100-0001» и «89001000001» — один номер. */
function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
}

function matchesQuickFilter(user: OperationalUserDTO, quick: UserQuickFilter, now: Date): boolean {
  switch (quick) {
    case 'operators': return user.role === 'OPERATOR';
    case 'dispatchers': return user.role === 'DISPATCHER';
    case 'admins': return user.role === 'ADMIN';
    case 'assistants': return user.role === 'ASSISTANT';
    case 'blocked': return !user.isActive;
    case 'no-site': return needsAssignment(user) && user.assignedSites.length === 0;
    case 'no-crew': return needsAssignment(user) && user.activeCrew === null;
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

    if ([user.name, user.email, user.phone]
      .some((value) => value.toLocaleLowerCase('ru').includes(search))) return true;

    // Номер набирают как помнят: сплошными цифрами, через 8 или через +7.
    // В базе он хранится с дефисами, и точное совпадение строк не находило
    // ничего — поиск по телефону просто не работал.
    const digits = phoneDigits(search);
    return digits.length >= 3 && phoneDigits(user.phone).includes(digits);
  });
}

export function computeUserKpis(users: OperationalUserDTO[]): OpsKpiItem[] {
  const active = users.filter((user) => user.isActive).length;
  const operators = users.filter((user) => user.role === 'OPERATOR').length;
  const withoutAssignment = users.filter(
    (user) => needsAssignment(user) && (user.assignedSites.length === 0 || user.activeCrew === null)
  ).length;
  const blocked = users.length - active;

  return [
    { label: 'Всего', value: String(users.length), detail: 'учётных записей', tone: 'slate' },
    // Не «Активные»: `isActive` — это включённая учётная запись, а не работа на
    // объекте и не разрешение выйти в смену. Прежняя подпись читалась как
    // «столько людей работает», хотя означала «столько людей может войти».
    { label: 'Доступ включён', value: String(active), detail: 'могут войти', tone: 'emerald' },
    { label: 'Операторы', value: String(operators), detail: 'машинисты', tone: 'blue' },
    {
      label: 'Требуют закрепления',
      value: String(withoutAssignment),
      detail: 'операторы без объекта или бригады',
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
