import {
  computeReadinessScore,
  resolveReadinessOutcome,
  type ReadinessOutcome,
  type ReadinessVerdict,
  type TriggeredBlocker,
} from '../readiness-score';
import type {ReadinessRuleSet} from '../readiness-rules';
import type {EvaluationClock} from './clock';
import type {ReadinessEvidence} from './evidence';
import type {AuthoritativeReadinessFacts} from './facts';

export interface EvaluationWarning { code: string; message: string; actionLabel?: string }

export interface AuthoritativeEvaluation {
  allowed: boolean;
  status: 'READY' | 'BLOCKED';
  /**
   * Полный вердикт домена. `status` — его двоичная проекция, которую хранили
   * раньше; из-за неё «требуется подтверждение» и «запрещено» приходили на
   * экран одинаковыми. Пишем оба: status для совместимости, verdict — чтобы
   * не терять различие.
   */
  verdict: ReadinessVerdict;
  outcome: ReadinessOutcome;
  score: number;
  blockers: Array<TriggeredBlocker | {code: string; label: string; action: 'DENY_START'; actionLabel: string}>;
  warnings: EvaluationWarning[];
  evidence: ReadinessEvidence;
  facts: AuthoritativeReadinessFacts;
  calculatedAt: Date;
  ruleSetVersion: string;
}

export function evaluateReadiness(input: {
  facts: AuthoritativeReadinessFacts;
  rules: Readonly<ReadinessRuleSet> | null;
  evidence: Omit<ReadinessEvidence, 'evaluatedAt'>;
  clock: EvaluationClock;
}): AuthoritativeEvaluation {
  const calculatedAt = input.clock.now();
  const evidence = {...input.evidence, evaluatedAt: calculatedAt.toISOString()};
  if (!input.rules) {
    return {
      allowed: false,
      status: 'BLOCKED',
      verdict: 'DENIED',
      outcome: 'BLOCKED',
      score: 0,
      blockers: [{
        code: 'READINESS_RULES_NOT_PUBLISHED',
        label: 'Published readiness rules are required',
        action: 'DENY_START',
        actionLabel: 'Deny start',
      }],
      warnings: [], evidence, facts: input.facts, calculatedAt, ruleSetVersion: 'unpublished',
    };
  }

  const result = computeReadinessScore(input.facts, input.rules as ReadinessRuleSet);
  const permitRequired = input.rules.blockers.some((item) =>
    item.condition === 'VALID_WORK_PERMIT_REQUIRED' && item.isActive);
  // Замечание видит оператор на экране готовности, поэтому текст по-русски и
  // про дело: «правила не требуют» — это ответ разработчику, а не машинисту.
  // Если наряд просрочен, об этом уже сказало правило PERMIT_EXPIRED, и второе
  // сообщение «наряд не оформлен» рядом с ним противоречило бы первому.
  const permitWarnings = input.facts.permitValid !== true && !input.facts.permitExpired && !permitRequired
    ? [{code: 'WORK_PERMIT_MISSING_OPTIONAL', message: 'Наряд-допуск не оформлен (по правилам не обязателен)'}]
    : [];
  // Сработавшее правило с действием WARN_ONLY — это замечание, а не блокировка.
  // Держим их врозь, иначе интерфейс посчитает предупреждение критическим блокером.
  const blockers = result.blockers.filter((item) => item.action !== 'WARN_ONLY');
  const advisory: EvaluationWarning[] = result.blockers
    .filter((item) => item.action === 'WARN_ONLY')
    .map((item) => ({code: item.condition, message: item.label, actionLabel: item.actionLabel}));
  const warnings = [...advisory, ...permitWarnings];
  return {
    allowed: result.canStart,
    status: result.canStart ? 'READY' : 'BLOCKED',
    verdict: result.verdict,
    outcome: resolveReadinessOutcome({verdict: result.verdict, warningCount: warnings.length}),
    score: result.score,
    blockers,
    warnings,
    evidence,
    facts: input.facts,
    calculatedAt,
    ruleSetVersion: input.rules.version,
  };
}
