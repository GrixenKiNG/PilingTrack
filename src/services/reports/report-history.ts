// Pure, client-safe report-history helpers (no DB import). The DB-bound
// getReportHistory lives in report-history-service.ts and re-exports these.
// Keeping these here lets the admin client bundle import statusLabel / types
// without dragging Prisma + pg into the browser build.

export interface HistoryChange { label: string; before: string; after: string }
export interface ReportHistoryEvent {
  id: string;
  action: string;
  actionLabel: string;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  changes: HistoryChange[];
}
export interface ReportHistoryVersion { version: number; actorId: string; createdAt: string }
export interface ReportHistory { events: ReportHistoryEvent[]; versions: ReportHistoryVersion[] }

export interface NameLookups {
  pileGrade: Record<string, string>;
  drillingType: Record<string, string>;
  downtimeReason: Record<string, string>;
  site: Record<string, string>;
  user: Record<string, string>;
  equipment: Record<string, string>;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Создан', updated: 'Изменён', submitted: 'Отправлен', deleted: 'Удалён',
};
export function actionLabel(action: string): string { return ACTION_LABELS[action] ?? action; }

const STATUS_LABELS: Record<string, string> = { draft: 'Черновик', submitted: 'Отправлен' };
export function statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }

// Fields that change on every save but carry no evidentiary meaning.
const NOISE = new Set([
  'version', 'updatedAt', 'createdAt', 'vectorClock',
  'lastEditedById', 'lastEditedByName', 'lastEditedByRole', 'id', 'reportId',
]);

/* eslint-disable @typescript-eslint/no-explicit-any */
function fmtPiles(arr: unknown, names: Record<string, string>): string {
  if (!Array.isArray(arr)) return '—';
  return arr.map((p: any) => `${names[p.pileGradeId] ?? p.pileGradeId}: ${p.count} шт`).join('; ') || '—';
}
function fmtDrillings(arr: unknown, names: Record<string, string>): string {
  if (!Array.isArray(arr)) return '—';
  return arr.map((d: any) => `${names[d.typeId] ?? d.typeId}: ${d.count ?? 1} шт, ${d.meters} м`).join('; ') || '—';
}
function fmtDowntimes(arr: unknown, names: Record<string, string>): string {
  if (!Array.isArray(arr)) return '—';
  return arr.map((d: any) => `${names[d.reasonId] ?? d.reasonId}: ${d.duration} ч`).join('; ') || '—';
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function scalar(v: unknown): string { return v === null || v === undefined || v === '' ? '—' : String(v); }

export function humanizeDiff(diff: Record<string, unknown>, lookups: NameLookups): HistoryChange[] {
  const out: HistoryChange[] = [];
  for (const [field, value] of Object.entries(diff)) {
    if (NOISE.has(field)) continue;
    const { old: oldVal, new: newVal } = value as { old: unknown; new: unknown };
    switch (field) {
      case 'piles':
        out.push({ label: 'Сваи', before: fmtPiles(oldVal, lookups.pileGrade), after: fmtPiles(newVal, lookups.pileGrade) }); break;
      case 'drillings':
        out.push({ label: 'Бурение', before: fmtDrillings(oldVal, lookups.drillingType), after: fmtDrillings(newVal, lookups.drillingType) }); break;
      case 'downtimes':
        out.push({ label: 'Простои', before: fmtDowntimes(oldVal, lookups.downtimeReason), after: fmtDowntimes(newVal, lookups.downtimeReason) }); break;
      case 'status':
        out.push({ label: 'Статус', before: statusLabel(scalar(oldVal)), after: statusLabel(scalar(newVal)) }); break;
      case 'siteId':
        out.push({ label: 'Объект', before: lookups.site[scalar(oldVal)] ?? scalar(oldVal), after: lookups.site[scalar(newVal)] ?? scalar(newVal) }); break;
      case 'userId':
        out.push({ label: 'Оператор', before: lookups.user[scalar(oldVal)] ?? scalar(oldVal), after: lookups.user[scalar(newVal)] ?? scalar(newVal) }); break;
      case 'equipmentId':
        out.push({ label: 'Установка', before: lookups.equipment[scalar(oldVal)] ?? scalar(oldVal), after: lookups.equipment[scalar(newVal)] ?? scalar(newVal) }); break;
      case 'shiftStart':
        out.push({ label: 'Начало смены', before: scalar(oldVal), after: scalar(newVal) }); break;
      case 'shiftEnd':
        out.push({ label: 'Окончание смены', before: scalar(oldVal), after: scalar(newVal) }); break;
      case 'date':
        out.push({ label: 'Дата', before: scalar(oldVal), after: scalar(newVal) }); break;
      case 'shiftType':
        out.push({ label: 'Тип смены', before: scalar(oldVal), after: scalar(newVal) }); break;
      default:
        out.push({ label: field, before: scalar(oldVal), after: scalar(newVal) });
    }
  }
  return out;
}
