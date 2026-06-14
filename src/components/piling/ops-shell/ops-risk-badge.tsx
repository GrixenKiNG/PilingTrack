'use client';

import { cn } from '@/lib/utils';
import type { RiskLevel } from './types';

const RISK_STYLE: Record<Exclude<RiskLevel, 'none'>, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  critical: 'bg-red-50 text-red-700 ring-red-200',
};

/**
 * Risk status pill — the "статус риска, а не декоративный статус" element.
 * Renders nothing for `none`. Keep the label operational ("Отставание",
 * "Нет фото", "Просрочено"), not generic ("active"/"ok").
 */
export function OpsRiskBadge({ level, label }: { level: RiskLevel; label: string }) {
  if (level === 'none') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-3xs font-medium ring-1 ring-inset',
        RISK_STYLE[level],
      )}
    >
      {label}
    </span>
  );
}

/**
 * Pick the highest-severity risk from a list of conditions. Each condition is
 * `[predicate, level, label]`; the first matching critical wins, else warn, else
 * the supplied `okLabel` (or `none` if omitted). Keeps risk rules explicit and
 * hardcoded per module instead of a rules engine.
 */
export function resolveRisk(
  conditions: Array<[boolean, Exclude<RiskLevel, 'none' | 'ok'>, string]>,
  okLabel?: string,
): { level: RiskLevel; label: string } {
  const critical = conditions.find(([hit, lvl]) => hit && lvl === 'critical');
  if (critical) return { level: 'critical', label: critical[2] };
  const warn = conditions.find(([hit, lvl]) => hit && lvl === 'warn');
  if (warn) return { level: 'warn', label: warn[2] };
  return okLabel ? { level: 'ok', label: okLabel } : { level: 'none', label: '' };
}
