import {sanitizeRuleSet, type ReadinessRuleSet} from '../readiness-rules';

export function immutablePublishedRules(input: unknown): Readonly<ReadinessRuleSet> | null {
  if (!input) return null;
  const rules = sanitizeRuleSet(input);
  if (rules.status !== 'PUBLISHED') return null;
  const criteria = rules.criteria.map((item) => Object.freeze({...item}));
  const blockers = rules.blockers.map((item) => Object.freeze({...item}));
  Object.freeze(criteria);
  Object.freeze(blockers);
  return Object.freeze({
    ...rules,
    criteria,
    blockers,
  });
}
