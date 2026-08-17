import { resolveEffectiveRole } from '@/lib/types';
import { ServiceError } from '@/services/service-error';

/**
 * FOREMAN («Мастер») и SAFETY_ENGINEER («Инженер ОТ») заведены 2026-08-09.
 * Живых людей в этих ролях пока нет — работу делает администратор через
 * временное исполнение роли (`ACTING_ROLES` в `lib/types.ts`). Набор прав
 * ниже намеренно узкий: расширить его, когда роль получит человека, —
 * безопасно, а раздать лишнее сразу — нет. MECHANIC в этом перечислении
 * отсутствует исторически и поэтому не имеет ни одного права: проверка
 * `can()` для него всегда false, что и есть отказ по умолчанию.
 */
export type Role = 'ADMIN' | 'DISPATCHER' | 'OPERATOR' | 'ASSISTANT' | 'FOREMAN' | 'SAFETY_ENGINEER';

export type Ability =
  | 'analytics.read'
  | 'reports.read_all'
  | 'reports.read_cross_user'
  | 'reports.export'
  | 'reports.manage_all'
  | 'sites.read_all'
  | 'sites.manage'
  | 'sites.assign_users'
  | 'sites.manage_hierarchy'
  | 'users.manage'
  | 'users.documents.read_all'
  | 'equipment.manage'
  | 'maintenance.manage'
  | 'inspection.perform'
  | 'meter.record'
  | 'crews.read'
  | 'crews.manage'
  | 'crews.legacy_manage'
  | 'dictionary.manage'
  | 'telegram.manage'
  | 'system.read'
  | 'media.upload'
  | 'dlq.manage'
  | 'projections.rebuild';

export interface SessionActor {
  id: string;
  /** Собственная роль — она же попадает в журнал как «кто на самом деле». */
  role: string;
  /** Исполняемая роль: права считаются по ней, а не по собственной. */
  actingAs?: string | null;
}

const abilityRoles: Record<Ability, Role[]> = {
  'analytics.read': ['ADMIN', 'DISPATCHER', 'FOREMAN'],
  'reports.read_all': ['ADMIN', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER'],
  'reports.read_cross_user': ['ADMIN', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER'],
  'reports.export': ['ADMIN'],
  'reports.manage_all': ['ADMIN', 'DISPATCHER'],
  'sites.read_all': ['ADMIN', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER'],
  'sites.manage': ['ADMIN', 'DISPATCHER'],
  'sites.assign_users': ['ADMIN', 'DISPATCHER'],
  'sites.manage_hierarchy': ['ADMIN', 'DISPATCHER'],
  'users.manage': ['ADMIN'],
  // Документы работника (права на управление установкой, медосмотр, охрана
  // труда) видит не только кадровик: диспетчер обязан контролировать просрочку
  // перед сменой, инженер ОТ — перед допуском. Свои документы работник видит и
  // ведёт всегда, без этого права — проверка «свой ли это работник» живёт в
  // services/users/user-documents.ts. Заводить и удалять чужие документы
  // по-прежнему может только админ (users.manage).
  'users.documents.read_all': ['ADMIN', 'DISPATCHER', 'SAFETY_ENGINEER'],
  'equipment.manage': ['ADMIN'],
  // Инженер ОТ ведёт осмотры и наряды-допуски — они живут в контуре
  // обслуживания. Мастеру запись сюда не нужна: он смотрит и распределяет.
  // Право охватывает заявки, ремонты и планы ТО — то, что решает офис.
  'maintenance.manage': ['ADMIN', 'DISPATCHER', 'SAFETY_ENGINEER'],
  // Сменный осмотр — работа оператора, а не офиса: именно он обходит машину
  // перед сменой, и именно его сегодняшний осмотр открывает смену. Раньше
  // осмотры сидели под maintenance.manage, и оператор получал 403 на дело,
  // которое модуль сам ему предписывает. Отдельное право не даёт ему при
  // этом закрывать ремонтные заявки. Свои осмотры оператор видит только свои —
  // сужение в маршрутах, см. api/inspections.
  'inspection.perform': ['ADMIN', 'DISPATCHER', 'OPERATOR', 'SAFETY_ENGINEER'],
  // Снятие моточасов — тоже работа сменщика. Отдельно от maintenance.manage
  // по той же причине: показания фиксирует тот, кто стоит у машины.
  'meter.record': ['ADMIN', 'DISPATCHER', 'OPERATOR', 'SAFETY_ENGINEER'],
  'crews.read': ['ADMIN', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER'],
  'crews.manage': ['ADMIN', 'DISPATCHER'],
  'crews.legacy_manage': ['ADMIN'],
  'dictionary.manage': ['ADMIN'],
  'telegram.manage': ['ADMIN'],
  'system.read': ['ADMIN', 'DISPATCHER'],
  'media.upload': ['ADMIN', 'DISPATCHER', 'OPERATOR', 'FOREMAN', 'SAFETY_ENGINEER'],
  'dlq.manage': ['ADMIN'],
  'projections.rebuild': ['ADMIN'],
};

export function isPrivilegedRole(role: string) {
  return role === 'ADMIN' || role === 'DISPATCHER';
}

/**
 * Права считаются по ИСПОЛНЯЕМОЙ роли.
 *
 * `actingAs` кладёт в сессию `requireAuth`, проверив заголовок через
 * `canActAs`. Достаточно одной этой функции: все `can`/`assertCan` приложения
 * ходят через неё, и забыть учесть замещение негде. Раньше режим «Действую
 * как» жил только внутри техготовности — администратор в роли механика
 * оставался в остальном приложении администратором: видел Бригады, Аналитику и
 * Справочники, которых механику не видно, и любое действие выполнялось его
 * правами.
 *
 * Роль, неизвестная матрице (MECHANIC, ASSISTANT), даёт false — отказ по
 * умолчанию. Так и нужно: у них своя матрица в контуре готовности, а разделы
 * админки им не положены.
 */
export function can(user: { role: string; actingAs?: string | null }, ability: Ability) {
  return abilityRoles[ability].includes(resolveEffectiveRole(user.role, user.actingAs) as Role);
}

export function assertCan(user: { role: string; actingAs?: string | null }, ability: Ability) {
  if (!can(user, ability)) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

// Проверки по роли тоже смотрят на исполняемую: иначе администратор в режиме
// механика проходил бы туда, куда механику нельзя, — а именно это и есть смысл
// режима «Действую как».
export function assertRole(user: { role: string; actingAs?: string | null }, role: Role) {
  if (resolveEffectiveRole(user.role, user.actingAs) !== role) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

export function assertAnyRole(user: { role: string; actingAs?: string | null }, roles: Role[]) {
  if (!roles.includes(resolveEffectiveRole(user.role, user.actingAs) as Role)) {
    throw new ServiceError('Доступ запрещён', 403);
  }
}

export function assertNotSelfAction(actorId: string, targetId: string, message: string) {
  if (actorId === targetId) {
    throw new ServiceError(message, 400);
  }
}

export function resolveUserScope(
  sessionUser: SessionActor,
  requestedUserId?: string | null,
  ability: Ability = 'reports.read_cross_user'
) {
  if (requestedUserId && requestedUserId !== sessionUser.id) {
    assertCan(sessionUser, ability);
    return requestedUserId;
  }

  return requestedUserId || sessionUser.id;
}
