import type { ActingRole } from '@/lib/types';
import {
  DEFAULT_ACCESS_MATRIX,
  abilitiesForRole,
  isReadinessRole,
  type ReadinessAccessMatrix,
} from '../domain/access-matrix';
import {
  READINESS_ABILITIES,
  type ReadinessAbility,
  type ReadinessRole,
} from '../domain/capability-defaults';

// Словарь полномочий и значения по умолчанию переехали в домен: ими
// пользуется и проверка прав, и редактируемая матрица доступов. Переэкспорт
// оставлен, чтобы прежние импорты из этого модуля продолжали работать.
export { READINESS_ABILITIES, isReadinessRole };
export type { ReadinessAbility, ReadinessRole };

export interface ReadinessActor {
  id: string;
  role: string;
}

export interface ReadinessActingAudit {
  actorId: string;
  actualRole: 'ADMIN';
  actingAs: ActingRole;
}

/**
 * Права роли по действующей матрице.
 *
 * `matrix` не задан — берутся значения по умолчанию из кода. Так работает
 * контур у организации, которая свою матрицу ещё не публиковала.
 */
export function resolveReadinessCapabilities(
  role: string,
  matrix: ReadinessAccessMatrix = DEFAULT_ACCESS_MATRIX,
): ReadonlySet<ReadinessAbility> {
  return abilitiesForRole(matrix, role);
}

/**
 * Права, которыми команда реально располагает: свои плюс права исполняемой роли.
 *
 * Тот же расчёт, что отдаётся экрану в bootstrap, только без записи в журнал —
 * замещение уже подписано при входе в раздел. Раньше команды сверялись лишь с
 * собственной ролью и отдельно допускали зашитый случай «администратор за
 * механика»: экран показывал инженеру ОТ доступное действие, а сервер отвечал
 * отказом. Одна функция на оба конца убирает расхождение.
 */
export function effectiveReadinessCapabilities(
  actorRole: string,
  actingAs: string | null | undefined,
  matrix: ReadinessAccessMatrix = DEFAULT_ACCESS_MATRIX,
): ReadonlySet<ReadinessAbility> {
  const own = resolveReadinessCapabilities(actorRole, matrix);
  if (!actingAs) return own;
  // Замещать роль может только администратор — то же правило, что в canActAs.
  if (actorRole !== 'ADMIN' || !isReadinessRole(actingAs)) return own;
  // Права ИСПОЛНЯЕМОЙ роли, а не сумма со своими.
  //
  // Раньше здесь было объединение, и «Действую как механик» ничего не
  // ограничивало: администратор сохранял все свои полномочия и мог, например,
  // менять матрицу доступов из режима механика. Журнал при этом писал
  // «действует как механик» — то есть подпись расходилась с тем, что человек
  // на самом деле мог. Замещение — исполнение роли, а не добавка к своей.
  return abilitiesForRole(matrix, actingAs);
}

/** Кто действует: своя роль, исполняемая роль и опубликованная матрица организации. */
export interface ReadinessActorRights {
  actorRole: string;
  actingAs: string | null;
  /** Не задана — значения по умолчанию из кода. */
  accessMatrix?: ReadinessAccessMatrix;
}

/**
 * Права команд над дефектами — тем же расчётом, что экран получает в bootstrap
 * (`effectiveReadinessCapabilities`). Раньше команды сверялись со встроенной
 * матрицей и собственной ролью плюс зашитым «админ за механика»: после первой
 * публикации прав кнопки «Взять в работу / Отклонить» и сервер расходились, а
 * администратор в роли инженера ОТ видел кнопку и получал отказ (аудит R18-1).
 */
export function canReportDefects(rights: ReadinessActorRights): boolean {
  return effectiveReadinessCapabilities(rights.actorRole, rights.actingAs, rights.accessMatrix)
    .has('readiness.defect.report');
}

export function canManageDefects(rights: ReadinessActorRights): boolean {
  return effectiveReadinessCapabilities(rights.actorRole, rights.actingAs, rights.accessMatrix)
    .has('readiness.defect.manage');
}

export async function resolveAuditedReadinessCapabilities(
  actor: ReadinessActor,
  actingAs: ActingRole | null,
  recordAudit: (entry: ReadinessActingAudit) => Promise<void>,
  matrix: ReadinessAccessMatrix = DEFAULT_ACCESS_MATRIX,
): Promise<ReadonlySet<ReadinessAbility>> {
  const actual = resolveReadinessCapabilities(actor.role, matrix);
  if (actingAs === null) {
    return actual;
  }
  if (actor.role !== 'ADMIN') {
    return new Set();
  }

  // В журнал уходит именно та роль, которую администратор исполняет, а не
  // всегда «механик»: иначе действия мастера и инженера ОТ были бы неотличимы
  // от механических, и доказательный журнал врал бы.
  await recordAudit({
    actorId: actor.id,
    actualRole: 'ADMIN',
    actingAs,
  });

  // Как и в effectiveReadinessCapabilities — права исполняемой роли, а не сумма.
  return abilitiesForRole(matrix, actingAs);
}

export function hasReadinessCapability(
  capabilities: ReadonlySet<ReadinessAbility>,
  ability: ReadinessAbility,
): boolean {
  return capabilities.has(ability);
}

export function serializeReadinessCapabilities(
  capabilities: ReadonlySet<ReadinessAbility>,
): ReadinessAbility[] {
  return READINESS_ABILITIES.filter((ability) => capabilities.has(ability));
}
