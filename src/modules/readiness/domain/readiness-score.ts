import {
  BLOCKER_ACTION_LABELS,
  BLOCKER_LABELS,
  CRITERION_LABELS,
  DEFAULT_READINESS_RULES,
  normalizeWeights,
  type BlockerAction,
  type BlockerCondition,
  type ReadinessCriterionKey,
  type ReadinessRuleSet,
} from './readiness-rules';

export interface ReadinessFacts {
  inspectionCompleted: boolean;
  inspectionProgress: number;
  healthScore: number | null;
  meterKnown: boolean;
  permitValid: boolean | null;
  permitExpired: boolean;
  maintenanceConfigured: boolean;
  maintenanceOverdueHours: number;
  maintenanceOverdueDays: number;
  accepted: boolean;
  criticalDefect: boolean;
  findings: number;
}

export type CriterionState = 'pass' | 'partial' | 'fail';

export interface CriterionScore {
  key: ReadinessCriterionKey;
  title: string;
  hint: string;
  weight: number;
  earned: number;
  ratio: number;
  state: CriterionState;
  value: string;
}

export interface TriggeredBlocker {
  condition: BlockerCondition;
  action: BlockerAction;
  label: string;
  actionLabel: string;
}

export type ReadinessVerdict =
  | 'ALLOWED'
  | 'CONFIRMATION_REQUIRED'
  | 'RETURN_TO_OPERATOR'
  | 'DENIED';

export interface ReadinessScoreResult {
  score: number;
  criteria: CriterionScore[];
  blockers: TriggeredBlocker[];
  criticalBlockers: number;
  findings: number;
  verdict: ReadinessVerdict;
  verdictLabel: string;
  canStart: boolean;
  ruleVersion: string;
}

const VERDICT_LABELS: Record<ReadinessVerdict, string> = {
  ALLOWED: 'Запуск разрешён',
  CONFIRMATION_REQUIRED: 'Требуется подтверждение',
  RETURN_TO_OPERATOR: 'Возврат оператору',
  DENIED: 'Запуск запрещён',
};

const VERDICT_RANK: Record<ReadinessVerdict, number> = {
  ALLOWED: 0,
  CONFIRMATION_REQUIRED: 1,
  RETURN_TO_OPERATOR: 2,
  DENIED: 3,
};

const ACTION_VERDICT: Record<BlockerAction, ReadinessVerdict> = {
  REQUIRE_CONFIRMATION: 'CONFIRMATION_REQUIRED',
  RETURN_TO_OPERATOR: 'RETURN_TO_OPERATOR',
  DENY_START: 'DENIED',
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function criterionRatio(
  key: ReadinessCriterionKey,
  facts: ReadinessFacts,
): { ratio: number; value: string } {
  switch (key) {
    case 'INSPECTION': {
      const progress = clamp01(facts.inspectionProgress);
      const health = facts.healthScore == null ? 1 : clamp01(facts.healthScore / 100);
      const ratio = facts.inspectionCompleted ? progress * health : progress * health * 0.5;
      return {
        ratio,
        value: facts.inspectionCompleted
          ? `выполнен · ${Math.round(progress * 100)}%`
          : `в работе · ${Math.round(progress * 100)}%`,
      };
    }
    case 'ENGINE_HOURS':
      return {
        ratio: facts.meterKnown ? 1 : 0,
        value: facts.meterKnown ? 'подтверждены' : 'нет показания',
      };
    case 'PERMIT':
      if (facts.permitValid == null) return { ratio: 1, value: 'не требуется' };
      if (facts.permitExpired) return { ratio: 0, value: 'просрочен' };
      return {
        ratio: facts.permitValid ? 1 : 0.4,
        value: facts.permitValid ? 'действует' : 'на согласовании',
      };
    case 'MAINTENANCE':
      if (!facts.maintenanceConfigured) {
        return { ratio: 0, value: 'регламент не настроен' };
      }
      if (facts.maintenanceOverdueHours > 0) {
        return {
          ratio: clamp01(1 - facts.maintenanceOverdueHours / 100),
          value: `перебег ${facts.maintenanceOverdueHours} м/ч`,
        };
      }
      if (facts.maintenanceOverdueDays > 0) {
        return {
          ratio: clamp01(1 - facts.maintenanceOverdueDays / 30),
          value: `просрочено на ${facts.maintenanceOverdueDays} дн.`,
        };
      }
      return { ratio: 1, value: 'срок не нарушен' };
    case 'ACCEPTANCE':
      return {
        ratio: facts.accepted ? 1 : 0,
        value: facts.accepted ? 'принята' : 'ожидает приёмки',
      };
  }
}

function blockerTriggered(condition: BlockerCondition, facts: ReadinessFacts): boolean {
  switch (condition) {
    case 'CRITICAL_DEFECT':
      return facts.criticalDefect;
    case 'PERMIT_EXPIRED':
      return facts.permitExpired;
    case 'MAINTENANCE_OVERDUE_50H':
      return facts.maintenanceOverdueHours > 50;
    case 'INSPECTION_BELOW_80':
      return clamp01(facts.inspectionProgress) < 0.8;
    case 'VALID_WORK_PERMIT_REQUIRED':
      return facts.permitValid !== true || facts.permitExpired;
  }
}

export function computeReadinessScore(
  facts: ReadinessFacts,
  rules: ReadinessRuleSet = DEFAULT_READINESS_RULES,
): ReadinessScoreResult {
  const criteria = normalizeWeights(rules.criteria).map((criterion) => {
    const { ratio, value } = criterionRatio(criterion.key, facts);
    const meta = CRITERION_LABELS[criterion.key];
    return {
      key: criterion.key,
      title: meta.title,
      hint: meta.hint,
      weight: criterion.weight,
      earned: Math.round(criterion.weight * ratio),
      ratio,
      state: ratio >= 0.999 ? 'pass' : ratio > 0 ? 'partial' : 'fail',
      value,
    } satisfies CriterionScore;
  });

  const blockers = rules.blockers
    .filter((rule) => rule.isActive && blockerTriggered(rule.condition, facts))
    .map((rule) => ({
      condition: rule.condition,
      action: rule.action,
      label: BLOCKER_LABELS[rule.condition],
      actionLabel: BLOCKER_ACTION_LABELS[rule.action],
    }));

  const verdict = blockers.reduce<ReadinessVerdict>((worst, blocker) => {
    const candidate = ACTION_VERDICT[blocker.action];
    return VERDICT_RANK[candidate] > VERDICT_RANK[worst] ? candidate : worst;
  }, 'ALLOWED');

  return {
    score: Math.min(100, Math.max(0, criteria.reduce((sum, item) => sum + item.earned, 0))),
    criteria,
    blockers,
    criticalBlockers: blockers.filter((item) => item.action === 'DENY_START').length,
    findings: facts.findings,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    canStart: verdict === 'ALLOWED',
    ruleVersion: rules.version,
  };
}

export const READINESS_READY_THRESHOLD = 85;

export function readinessTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= READINESS_READY_THRESHOLD) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}
