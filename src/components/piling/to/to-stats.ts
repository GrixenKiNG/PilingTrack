/**
 * Pure ТО-journal logic — record classification, KPI aggregation and due-date
 * helpers. Extracted from to-module.tsx so the screen carries no business logic
 * and these are unit-testable. Presentation (labels, colours, formatting) stays
 * in the component.
 */

export interface JournalRecord {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  engineHoursAtService: number | null;
  inspection: { id: string; healthScore: number | null; status: string; level: string } | null;
}

const INSPECTION_TYPES = new Set(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'INSPECTION']);
const OPEN_STATUSES = new Set(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD']);

export const isInspectionRecord = (record: JournalRecord) => INSPECTION_TYPES.has(record.type);
export const isOpenRecord = (record: JournalRecord) => OPEN_STATUSES.has(record.status);

export interface ToStats {
  inspections: number;
  repairs: number;
  open: number;
  /** Mean inspection healthScore (rounded), or null when none are scored. */
  averageScore: number | null;
}

export function computeToStats(records: JournalRecord[]): ToStats {
  const inspections = records.filter(isInspectionRecord);
  const repairs = records.filter((record) => !isInspectionRecord(record));
  const open = records.filter(isOpenRecord);
  const scores = inspections
    .map((record) => record.inspection?.healthScore)
    .filter((score): score is number => typeof score === 'number');
  const averageScore = scores.length
    ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : null;
  return { inspections: inspections.length, repairs: repairs.length, open: open.length, averageScore };
}

/** Whole days from `now` (midnight) to `value` (midnight); null if unparseable. */
export function daysUntil(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

/** Human due-date phrase in Russian ("просрочено" / "сегодня" / "через N дн."). */
export function dueText(value: string | null | undefined, now: Date = new Date()): string {
  const days = daysUntil(value, now);
  if (days == null) return 'срок не задан';
  if (days < 0) return 'просрочено';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} дн.`;
}
