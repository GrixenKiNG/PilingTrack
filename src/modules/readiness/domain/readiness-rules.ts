export const READINESS_CRITERION_KEYS = [
  'INSPECTION',
  'ENGINE_HOURS',
  'PERMIT',
  'MAINTENANCE',
  'ACCEPTANCE',
] as const;

export type ReadinessCriterionKey = (typeof READINESS_CRITERION_KEYS)[number];

export const CRITERION_LABELS: Record<ReadinessCriterionKey, { title: string; hint: string }> = {
  INSPECTION: { title: 'Осмотр', hint: 'Проверка узлов и систем' },
  ENGINE_HOURS: { title: 'Моточасы', hint: 'Фиксация показаний' },
  PERMIT: { title: 'Наряд-допуск', hint: 'Допуск и условия' },
  MAINTENANCE: { title: 'Обслуживание', hint: 'Плановое ТО и ремонты' },
  ACCEPTANCE: { title: 'Приёмка диспетчером', hint: 'Подтверждение готовности' },
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
    { condition: 'MAINTENANCE_OVERDUE_50H', action: 'REQUIRE_CONFIRMATION', isActive: true },
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

export function bumpVersion(version: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (!match) return 'v1.0';
  return `v${match[1]}.${Number(match[2]) + 1}`;
}
