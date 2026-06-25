/**
 * Pure PM-plan due-status math (P3). No db imports, so both the scheduler
 * worker and client UI can use it. Given a plan rule + the rig's latest engine
 * hours + now, decides ok / due_soon / overdue.
 */

const SOON_HOURS = 50;
const DAY_MS = 86_400_000;

export type PmTriggerType = 'HOURS' | 'CALENDAR';
export type PmDueStatus = 'ok' | 'due_soon' | 'overdue';

export interface PlanForEval {
  triggerType: PmTriggerType;
  intervalHours?: number | null;
  intervalDays?: number | null;
  leadTimeDays: number;
  lastDoneHours?: number | null;
  lastDoneAt?: Date | string | null;
}

export interface PlanDueResult {
  status: PmDueStatus;
  /** HOURS: engine-hours target for the next service (lastDone + interval). */
  targetHours: number | null;
  /** HOURS: target − current; negative means overdue by that many hours. */
  hoursRemaining: number | null;
  /** CALENDAR: lastDoneAt + intervalDays. */
  dueDate: Date | null;
  /** CALENDAR: whole days until dueDate; negative means overdue. */
  daysRemaining: number | null;
}

const toDate = (v: Date | string | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Decide whether a plan is ok / due soon / overdue. `latestHours` is the rig's
 * most recent meter reading (only used for HOURS plans). Pure.
 */
export function evaluatePlanDue(
  plan: PlanForEval,
  latestHours: number | null,
  now: Date = new Date(),
): PlanDueResult {
  const base: PlanDueResult = {
    status: 'ok',
    targetHours: null,
    hoursRemaining: null,
    dueDate: null,
    daysRemaining: null,
  };

  if (plan.triggerType === 'HOURS') {
    if (plan.intervalHours == null || latestHours == null || plan.lastDoneHours == null) {
      return base; // not enough data to judge — treat as ok (no false alarms)
    }
    const targetHours = plan.lastDoneHours + plan.intervalHours;
    const hoursRemaining = targetHours - latestHours;
    const status: PmDueStatus =
      hoursRemaining <= 0 ? 'overdue' : hoursRemaining <= SOON_HOURS ? 'due_soon' : 'ok';
    return { ...base, status, targetHours, hoursRemaining };
  }

  // CALENDAR
  const last = toDate(plan.lastDoneAt);
  if (plan.intervalDays == null || last == null) return base;
  const dueDate = new Date(last.getTime() + plan.intervalDays * DAY_MS);
  const daysRemaining = Math.floor((dueDate.getTime() - now.getTime()) / DAY_MS);
  const status: PmDueStatus =
    daysRemaining < 0 ? 'overdue' : daysRemaining <= plan.leadTimeDays ? 'due_soon' : 'ok';
  return { ...base, status, dueDate, daysRemaining };
}
