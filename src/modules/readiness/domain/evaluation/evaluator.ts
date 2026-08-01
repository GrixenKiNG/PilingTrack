import {computeReadinessScore, type TriggeredBlocker} from '../readiness-score';
import type {ReadinessRuleSet} from '../readiness-rules';
import type {EvaluationClock} from './clock';
import type {ReadinessEvidence} from './evidence';
import type {AuthoritativeReadinessFacts} from './facts';

export interface EvaluationWarning { code: string; message: string }

export interface AuthoritativeEvaluation {
  allowed: boolean;
  status: 'READY' | 'BLOCKED';
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
  const warnings = input.facts.permitValid !== true && !permitRequired
    ? [{code: 'WORK_PERMIT_MISSING_OPTIONAL', message: 'Valid work permit is not required by published rules'}]
    : [];
  return {
    allowed: result.canStart,
    status: result.canStart ? 'READY' : 'BLOCKED',
    score: result.score,
    blockers: result.blockers,
    warnings,
    evidence,
    facts: input.facts,
    calculatedAt,
    ruleSetVersion: input.rules.version,
  };
}
