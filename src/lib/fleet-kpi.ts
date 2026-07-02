/**
 * Fleet maintenance KPIs (P5) — MTBF / MTTR / availability / PM-compliance /
 * cost / top problem rigs, computed purely from MaintenanceRecord rows over a
 * period. No db here so it's unit-testable and reusable on the client.
 *
 * Definitions (per the maintenance design spec §6):
 * - Failure  = a REPAIR or FAULT work order.
 * - Downtime = Σ (completedAt − startedAt) over closed failures, PLUS the
 *   still-running time of OPEN failures (startedAt ?? createdAt → now, clamped
 *   to the period). A rig sitting in an unclosed repair used to contribute
 *   zero downtime, so availability showed 100% during a live repair.
 * - Fleet hours = period length × equipment count (total machine-hours).
 * - Operating hours = fleet hours − downtime.
 * - MTBF = operating hours / failure count.
 * - MTTR = mean repair duration (hours) — closed repairs only.
 * - Availability = operating hours / fleet hours (0..1).
 * - PM compliance = scheduled WOs closed / scheduled WOs **with a planned
 *   date**. Undated open WOs (zombie orders) used to inflate the denominator.
 */

const HOUR_MS = 3_600_000;

const FAILURE_TYPES = new Set(['REPAIR', 'FAULT']);
const SCHEDULED_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'SCHEDULED']);

export interface KpiRecord {
  equipmentId: string;
  equipmentName: string;
  type: string;
  status: string;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  cost: number | null;
  /** Fallback start for open failures that never got startedAt. */
  createdAt?: string | Date | null;
  /** Planned date — only dated scheduled WOs count toward PM compliance. */
  scheduledAt?: string | Date | null;
}

export interface ProblemRig {
  equipmentId: string;
  equipmentName: string;
  failures: number;
  cost: number;
}

export interface FleetKpi {
  /** Hours; null when there were no failures in the period. */
  mtbfHours: number | null;
  /** Hours; null when no repair has both startedAt and completedAt. */
  mttrHours: number | null;
  /** 0..1; null when the period/fleet is empty. */
  availability: number | null;
  failureCount: number;
  downtimeHours: number;
  /** Scheduled-maintenance compliance (closed / planned); null when none planned. */
  pmCompliance: number | null;
  pmPlanned: number;
  pmClosed: number;
  totalCost: number;
  topProblemRigs: ProblemRig[];
}

const toMs = (v: string | Date | null): number | null => {
  if (v == null) return null;
  const t = (v instanceof Date ? v : new Date(v)).getTime();
  return Number.isNaN(t) ? null : t;
};

export function computeFleetKpi(
  records: KpiRecord[],
  opts: { from: Date; to: Date; equipmentCount: number; now?: Date },
): FleetKpi {
  const periodHours = Math.max(0, (opts.to.getTime() - opts.from.getTime()) / HOUR_MS);
  const fleetHours = periodHours * Math.max(0, opts.equipmentCount);
  const nowMs = (opts.now ?? new Date()).getTime();

  const failures = records.filter((r) => FAILURE_TYPES.has(r.type));
  const failureCount = failures.length;

  const repairDurations: number[] = [];
  let downtimeHours = 0;
  for (const f of failures) {
    const s = toMs(f.startedAt);
    const c = toMs(f.completedAt);
    if (s != null && c != null && c > s) {
      const h = (c - s) / HOUR_MS;
      repairDurations.push(h);
      downtimeHours += h;
    } else if (c == null && f.status !== 'DONE' && f.status !== 'CANCELLED') {
      // Open failure: the rig is down right now. Count its running time
      // (clamped to the report period) so availability reflects reality
      // instead of showing 100% until someone closes the work order.
      // Excluded from MTTR — that stays "mean duration of closed repairs".
      const openStart = s ?? toMs(f.createdAt ?? null);
      if (openStart != null) {
        const end = Math.min(nowMs, opts.to.getTime());
        const start = Math.max(openStart, opts.from.getTime());
        if (end > start) downtimeHours += (end - start) / HOUR_MS;
      }
    }
  }

  const mttrHours = repairDurations.length
    ? repairDurations.reduce((a, b) => a + b, 0) / repairDurations.length
    : null;

  const operatingHours = Math.max(0, fleetHours - downtimeHours);
  const mtbfHours = failureCount > 0 ? operatingHours / failureCount : null;
  const availability = fleetHours > 0 ? operatingHours / fleetHours : null;

  // Only WOs with a planned date count: an undated WO can't be "on schedule"
  // or "late", and stale undated orders were dragging compliance toward zero.
  const scheduled = records.filter(
    (r) => SCHEDULED_TYPES.has(r.type) && r.scheduledAt != null,
  );
  const pmPlanned = scheduled.length;
  const pmClosed = scheduled.filter((r) => r.status === 'DONE').length;
  const pmCompliance = pmPlanned > 0 ? pmClosed / pmPlanned : null;

  const totalCost = records.reduce((sum, r) => sum + (r.cost ?? 0), 0);

  const byRig = new Map<string, ProblemRig>();
  for (const f of failures) {
    const cur = byRig.get(f.equipmentId) ?? {
      equipmentId: f.equipmentId,
      equipmentName: f.equipmentName,
      failures: 0,
      cost: 0,
    };
    cur.failures += 1;
    cur.cost += f.cost ?? 0;
    byRig.set(f.equipmentId, cur);
  }
  const topProblemRigs = [...byRig.values()]
    .sort((a, b) => b.failures - a.failures || b.cost - a.cost)
    .slice(0, 5);

  return {
    mtbfHours,
    mttrHours,
    availability,
    failureCount,
    downtimeHours,
    pmCompliance,
    pmPlanned,
    pmClosed,
    totalCost,
    topProblemRigs,
  };
}
