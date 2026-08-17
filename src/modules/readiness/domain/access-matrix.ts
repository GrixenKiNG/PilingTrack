/**
 * Матрица доступов контура готовности: роль → полномочия.
 *
 * До этого таблица «кто что может» жила единственной константой в коде, и
 * изменить её можно было только правкой исходников. Теперь это политика
 * организации с тем же жизненным циклом, что у правил готовности: черновик,
 * публикация, архив. Значения по умолчанию — ровно те, что были зашиты, чтобы
 * до первой публикации ничего не поменялось.
 *
 * Замков здесь намеренно нет. Возражение «администратору нельзя давать право
 * вести смену, иначе пропадёт подпись о замещении» проверено и снято: журнал
 * готовности хранит `userName`, `userRole` и `actingAs` отдельно у каждого
 * действия (`infrastructure/audit/audit-repository.ts`), поэтому «кто именно
 * нажал» доказывается именем в записи, а не отсутствием права. Решение
 * владельца от 16.08.2026.
 */

import {
  READINESS_ABILITIES,
  READINESS_ROLE_LIST,
  ROLE_ABILITIES,
  type ReadinessAbility,
  type ReadinessRole,
} from './capability-defaults';

export type AccessMatrixStatus = 'DRAFT' | 'PUBLISHED';

export interface ReadinessAccessMatrix {
  version: string;
  status: AccessMatrixStatus;
  /** Роль → её полномочия. Роли и полномочия только из известных списков. */
  grants: Record<ReadinessRole, ReadinessAbility[]>;
  updatedAt?: string;
  updatedBy?: string;
  publishedAt?: string | null;
}

const ABILITY_SET = new Set<string>(READINESS_ABILITIES);
const ROLE_SET = new Set<string>(READINESS_ROLE_LIST);

/** Порядок полномочий фиксируем по списку модуля: так сравнение версий стабильно. */
function orderAbilities(abilities: Iterable<string>): ReadinessAbility[] {
  const present = new Set(abilities);
  return READINESS_ABILITIES.filter((ability) => present.has(ability));
}

export const DEFAULT_ACCESS_MATRIX: ReadinessAccessMatrix = {
  version: 'v1.0',
  status: 'PUBLISHED',
  grants: Object.fromEntries(
    READINESS_ROLE_LIST.map((role) => [role, orderAbilities(ROLE_ABILITIES[role])]),
  ) as Record<ReadinessRole, ReadinessAbility[]>,
};

/**
 * Приводит присланное к известным ролям и полномочиям.
 *
 * Неизвестный ключ роли или полномочия отбрасывается молча: матрица — это
 * список разрешений, и принимать в него незнакомое значение опаснее, чем
 * потерять опечатку. Роль, которой в присланном нет вовсе, берётся из
 * образца — иначе частичное сохранение обнулило бы доступ остальным.
 */
export function sanitizeAccessMatrix(
  input: unknown,
  fallback: ReadinessAccessMatrix = DEFAULT_ACCESS_MATRIX,
): ReadinessAccessMatrix {
  const source = (input ?? {}) as Partial<ReadinessAccessMatrix> & { grants?: unknown };
  const rawGrants = (source.grants ?? {}) as Record<string, unknown>;

  const grants = Object.fromEntries(READINESS_ROLE_LIST.map((role) => {
    const value = rawGrants[role];
    if (!Array.isArray(value)) return [role, [...fallback.grants[role] ?? []]];
    const known = value.filter((item): item is string => typeof item === 'string' && ABILITY_SET.has(item));
    return [role, orderAbilities(known)];
  })) as Record<ReadinessRole, ReadinessAbility[]>;

  return {
    version: typeof source.version === 'string' && source.version.trim() !== ''
      ? source.version
      : fallback.version,
    status: source.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
    grants,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : undefined,
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : undefined,
    publishedAt: typeof source.publishedAt === 'string' ? source.publishedAt : null,
  };
}

export interface AccessMatrixChange {
  role: ReadinessRole;
  ability: ReadinessAbility;
  granted: boolean;
}

/** Пофамильный список отличий — им подписывается публикация и считается счётчик правок. */
export function describeAccessChanges(
  before: ReadinessAccessMatrix,
  after: ReadinessAccessMatrix,
): AccessMatrixChange[] {
  const changes: AccessMatrixChange[] = [];
  for (const role of READINESS_ROLE_LIST) {
    const had = new Set(before.grants[role] ?? []);
    const has = new Set(after.grants[role] ?? []);
    for (const ability of READINESS_ABILITIES) {
      if (had.has(ability) === has.has(ability)) continue;
      changes.push({ role, ability, granted: has.has(ability) });
    }
  }
  return changes;
}

/** Проверка, что роль вообще существует в контуре. */
export function isReadinessRole(role: string): role is ReadinessRole {
  return ROLE_SET.has(role);
}

export function abilitiesForRole(
  matrix: ReadinessAccessMatrix,
  role: string,
): ReadonlySet<ReadinessAbility> {
  if (!isReadinessRole(role)) return new Set();
  return new Set(matrix.grants[role] ?? []);
}
