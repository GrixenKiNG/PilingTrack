export const READINESS_CRITERION_KEYS = [
  'INSPECTION',
  'ENGINE_HOURS',
  'PERMIT',
  'MAINTENANCE',
  'ACCEPTANCE',
] as const;

export type ReadinessCriterionKey = (typeof READINESS_CRITERION_KEYS)[number];

/** `short` — для узких колонок (предпросмотр расчёта), где полное имя не влезает. */
export const CRITERION_LABELS: Record<ReadinessCriterionKey, { title: string; short: string; hint: string }> = {
  INSPECTION: { title: 'Осмотр', short: 'Осмотр', hint: 'Проверка узлов и систем' },
  ENGINE_HOURS: { title: 'Моточасы', short: 'Моточасы', hint: 'Фиксация показаний' },
  PERMIT: { title: 'Наряд-допуск', short: 'Наряд', hint: 'Допуск и условия' },
  MAINTENANCE: { title: 'Обслуживание', short: 'ТО', hint: 'Плановое ТО и ремонты' },
  ACCEPTANCE: { title: 'Приёмка диспетчером', short: 'Приёмка', hint: 'Подтверждение готовности' },
};

export interface ReadinessCriterion {
  key: ReadinessCriterionKey;
  weight: number;
  locked: boolean;
}

export const BLOCKER_CONDITIONS = [
  'CRITICAL_DEFECT',
  'VALID_WORK_PERMIT_REQUIRED',
  'PERMIT_EXPIRED',
  'MAINTENANCE_OVERDUE_50H',
  'INSPECTION_BELOW_80',
] as const;

export type BlockerCondition = (typeof BLOCKER_CONDITIONS)[number];

export const BLOCKER_ACTIONS = [
  'DENY_START',
  'REQUIRE_CONFIRMATION',
  'RETURN_TO_OPERATOR',
  // Замечание видно оператору и диспетчеру, но запуск не останавливает.
  'WARN_ONLY',
] as const;

export type BlockerAction = (typeof BLOCKER_ACTIONS)[number];

export const BLOCKER_LABELS: Record<BlockerCondition, string> = {
  VALID_WORK_PERMIT_REQUIRED: 'Действующий наряд-допуск обязателен',
  CRITICAL_DEFECT: 'Критический дефект',
  PERMIT_EXPIRED: 'Просроченный наряд-допуск',
  MAINTENANCE_OVERDUE_50H: 'ТО просрочено более 50 м/ч',
  INSPECTION_BELOW_80: 'Осмотр выполнен менее чем на 80%',
};

export const BLOCKER_ACTION_LABELS: Record<BlockerAction, string> = {
  DENY_START: 'Запретить запуск',
  REQUIRE_CONFIRMATION: 'Требовать подтверждение',
  RETURN_TO_OPERATOR: 'Вернуть оператору',
  WARN_ONLY: 'Предупредить, работу не останавливать',
};

export interface ReadinessBlockerRule {
  condition: BlockerCondition;
  action: BlockerAction;
  isActive: boolean;
}

export type RuleSetStatus = 'DRAFT' | 'PUBLISHED';

export interface ReadinessRuleSet {
  version: string;
  status: RuleSetStatus;
  criteria: ReadinessCriterion[];
  blockers: ReadinessBlockerRule[];
  updatedAt?: string;
  updatedBy?: string;
  publishedAt?: string | null;
}

export const DEFAULT_READINESS_RULES: ReadinessRuleSet = {
  version: 'v1.0',
  status: 'PUBLISHED',
  criteria: [
    { key: 'INSPECTION', weight: 30, locked: false },
    { key: 'ENGINE_HOURS', weight: 15, locked: false },
    { key: 'PERMIT', weight: 25, locked: false },
    { key: 'MAINTENANCE', weight: 20, locked: false },
    { key: 'ACCEPTANCE', weight: 10, locked: false },
  ],
  blockers: [
    { condition: 'CRITICAL_DEFECT', action: 'DENY_START', isActive: true },
    { condition: 'VALID_WORK_PERMIT_REQUIRED', action: 'DENY_START', isActive: false },
    { condition: 'PERMIT_EXPIRED', action: 'DENY_START', isActive: true },
    // Просроченное ТО снижает балл и показывает замечание, но установку не
    // останавливает — решение владельца от 2026-08-08. Тенант может ужесточить
    // правило в «Настройки → Правила готовности», не трогая код.
    { condition: 'MAINTENANCE_OVERDUE_50H', action: 'WARN_ONLY', isActive: true },
    { condition: 'INSPECTION_BELOW_80', action: 'RETURN_TO_OPERATOR', isActive: false },
  ],
};

const clampWeight = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
};

function distributeWeights(items: ReadinessCriterion[], budget: number) {
  if (!items.length) return;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total === 0) {
    const even = Math.floor(budget / items.length);
    items.forEach((item, index) => {
      item.weight = index === items.length - 1
        ? budget - even * (items.length - 1)
        : even;
    });
    return;
  }
  items.forEach((item) => {
    item.weight = Math.round((item.weight / total) * budget);
  });
  const drift = budget - items.reduce((sum, item) => sum + item.weight, 0);
  if (drift !== 0) {
    const heaviest = items.reduce((left, right) =>
      right.weight > left.weight ? right : left);
    heaviest.weight += drift;
  }
}

export function normalizeWeights(criteria: ReadinessCriterion[]): ReadinessCriterion[] {
  const items = criteria.map((item) => ({ ...item, weight: clampWeight(item.weight) }));
  const locked = items.filter((item) => item.locked);
  const free = items.filter((item) => !item.locked);
  const lockedTotal = locked.reduce((sum, item) => sum + item.weight, 0);

  if (lockedTotal > 100 || (!free.length && lockedTotal !== 100)) {
    distributeWeights(items, 100);
    return items;
  }

  distributeWeights(free, 100 - lockedTotal);
  return items;
}

export function sanitizeRuleSet(
  input: unknown,
  fallback: ReadinessRuleSet = DEFAULT_READINESS_RULES,
): ReadinessRuleSet {
  const raw = (input ?? {}) as Partial<ReadinessRuleSet>;
  const criteriaInput = Array.isArray(raw.criteria) ? raw.criteria : fallback.criteria;
  const criteriaByKey = new Map(criteriaInput.map((item) => [item?.key, item]));
  const criteria = normalizeWeights(READINESS_CRITERION_KEYS.map((key) => {
    const found = criteriaByKey.get(key);
    const base = fallback.criteria.find((item) => item.key === key);
    return {
      key,
      weight: clampWeight(found?.weight ?? base?.weight ?? 0),
      locked: Boolean(found?.locked ?? base?.locked ?? false),
    };
  }));

  const blockersInput = Array.isArray(raw.blockers) ? raw.blockers : fallback.blockers;
  const blockersByCondition = new Map(blockersInput.map((item) => [item?.condition, item]));
  const blockers = BLOCKER_CONDITIONS.map((condition) => {
    const found = blockersByCondition.get(condition);
    const base = fallback.blockers.find((item) => item.condition === condition);
    const action = found?.action ?? base?.action ?? 'DENY_START';
    return {
      condition,
      action: BLOCKER_ACTIONS.includes(action) ? action : 'DENY_START',
      isActive: Boolean(found?.isActive ?? base?.isActive ?? false),
    } satisfies ReadinessBlockerRule;
  });

  return {
    version: typeof raw.version === 'string' && raw.version ? raw.version : fallback.version,
    status: raw.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED',
    criteria,
    blockers,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : undefined,
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
  };
}

/**
 * Человекочитаемый список различий между наборами правил.
 *
 * Одна строка — одно изменение, и ровно на этом счёте держится счётчик
 * неопубликованных изменений: если критерий поменял и вес, и закрепление,
 * это по-прежнему одно изменение, а не два.
 */
export function describeRuleSetChanges(
  before: ReadinessRuleSet,
  after: ReadinessRuleSet,
): string[] {
  const changes: string[] = [];

  after.criteria.forEach((criterion) => {
    const previous = before.criteria.find((item) => item.key === criterion.key);
    const title = CRITERION_LABELS[criterion.key].title;
    if (!previous) {
      changes.push(`Добавлен критерий «${title}» — ${criterion.weight}%`);
      return;
    }
    const parts: string[] = [];
    if (previous.weight !== criterion.weight) {
      parts.push(`вес ${previous.weight} → ${criterion.weight}%`);
    }
    if (previous.locked !== criterion.locked) {
      parts.push(criterion.locked ? 'вес закреплён' : 'закрепление снято');
    }
    if (parts.length) changes.push(`${title}: ${parts.join(', ')}`);
  });

  after.blockers.forEach((blocker) => {
    const previous = before.blockers.find((item) => item.condition === blocker.condition);
    const label = BLOCKER_LABELS[blocker.condition];
    if (!previous) {
      changes.push(`Добавлено правило «${label}»`);
      return;
    }
    const parts: string[] = [];
    if (previous.isActive !== blocker.isActive) {
      parts.push(blocker.isActive ? 'включено' : 'отключено');
    }
    if (previous.action !== blocker.action) {
      parts.push(`${BLOCKER_ACTION_LABELS[previous.action]} → ${BLOCKER_ACTION_LABELS[blocker.action]}`);
    }
    if (parts.length) changes.push(`«${label}»: ${parts.join(', ')}`);
  });

  return changes;
}

export function bumpVersion(version: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (!match) return 'v1.0';
  return `v${match[1]}.${Number(match[2]) + 1}`;
}
