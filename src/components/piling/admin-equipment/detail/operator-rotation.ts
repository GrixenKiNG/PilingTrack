/**
 * Operator rotation — pure transform over a rig's report timeline.
 *
 * Collapses the report stream into maximal consecutive runs by operator
 * (a "segment"). A change of operator starts a new segment flagged as a
 * substitution. Read-only; no persistence. See the spec:
 * docs/superpowers/specs/2026-06-23-operator-rotation-history-design.md
 */

import type { TimelineRow } from './equipment-detail-parts';

export interface RotationSegment {
  operatorId: string | null;
  operatorName: string | null;
  startDate: string;
  endDate: string;
  shiftCount: number;
  siteNames: string[];
  isSubstitution: boolean;
}

// Same-day ordering so a day shift precedes a night shift deterministically.
const SHIFT_ORDER: Record<string, number> = { DAY: 0, NIGHT: 1 };

export function computeOperatorRotation(rows: TimelineRow[]): RotationSegment[] {
  if (rows.length === 0) return [];

  const sorted = [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (SHIFT_ORDER[a.shiftType] ?? 0) - (SHIFT_ORDER[b.shiftType] ?? 0);
  });

  const segments: RotationSegment[] = [];
  for (const r of sorted) {
    const last = segments[segments.length - 1];
    if (last && last.operatorId === r.operatorId) {
      last.endDate = r.date;
      last.shiftCount += 1;
      if (r.siteName && !last.siteNames.includes(r.siteName)) {
        last.siteNames.push(r.siteName);
      }
    } else {
      segments.push({
        operatorId: r.operatorId,
        operatorName: r.operatorName,
        startDate: r.date,
        endDate: r.date,
        shiftCount: 1,
        siteNames: r.siteName ? [r.siteName] : [],
        isSubstitution: segments.length > 0,
      });
    }
  }

  // Newest first for display.
  return segments.reverse();
}
