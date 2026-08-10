'use client';

/**
 * Словари типов/статусов ТО и презентационные кирпичи рабочего центра ТО
 * (строка журнала, вкладка, инфо-строки, пустые/загрузочные блоки).
 * Выделено из to-module.tsx (аудит A-8: файл был 597 строк).
 */

import Link from 'next/link';
import { CheckCircle2, Loader2, type LucideIcon } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import { healthScoreColor } from '@/components/piling/inspections/inspection-labels';
import {
  type JournalRecord,
  type OverdueMaintenance,
  isInspectionRecord,
  staleOpenOrderDays,
  dueText,
} from './to-stats';

/** Presentation for an overdue-ТО exception chip (logic stays in to-stats). */
export function overdueLabel(item: OverdueMaintenance): string {
  const parts: string[] = [];
  if (item.overdueDays != null) parts.push(`просрочка ${item.overdueDays} дн.`);
  if (item.overdueHours != null) parts.push(`+${item.overdueHours} м.ч. сверх порога`);
  return parts.join(' · ');
}

export type HammerKind = 'HYDRAULIC' | 'DIESEL' | 'NONE';

export interface EquipmentOption {
  id: string;
  name: string;
  model: string | null;
  hammerKind: HammerKind;
  isCombined: boolean;
  engineHoursTotal?: number | null;
  nextMaintenanceAtHours?: number | null;
  nextMaintenanceDate?: string | null;
  isActive: boolean;
  crewCount: number;
}

export const HAMMER_LABEL: Record<HammerKind, string> = {
  HYDRAULIC: 'Гидравлический',
  DIESEL: 'Дизельный',
  NONE: 'Нет',
};

export const TYPE_LABEL: Record<string, string> = {
  EO: 'ЕО',
  TO1: 'ТО-1',
  TO2: 'ТО-2',
  TO3: 'ТО-3',
  SEASONAL: 'Сезонное',
  REPAIR: 'Ремонт',
  FAULT: 'Неисправность',
  SCHEDULED: 'ТО',
  INSPECTION: 'Осмотр',
};

export const TYPE_STYLE: Record<string, string> = {
  EO: 'border-border bg-muted text-foreground',
  TO1: 'border-info/30 bg-info/10 text-info-strong',
  TO2: 'border-info/30 bg-info/10 text-info-strong',
  TO3: 'border-info/30 bg-info/10 text-info-strong',
  SEASONAL: 'border-info/30 bg-info/10 text-info-strong',
  REPAIR: 'border-destructive/30 bg-destructive/10 text-destructive-strong',
  FAULT: 'border-warning/30 bg-warning/10 text-warning-strong',
  SCHEDULED: 'border-info/30 bg-info/10 text-info-strong',
  INSPECTION: 'border-border bg-muted text-foreground',
};

export const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Запланирован',
  ASSIGNED: 'Назначен',
  IN_PROGRESS: 'В работе',
  ON_HOLD: 'Пауза',
  DONE: 'Закрыт',
  CANCELLED: 'Отменён',
};

export const STATUS_STYLE: Record<string, string> = {
  PLANNED: 'border-border bg-muted text-foreground',
  ASSIGNED: 'border-info/30 bg-info/10 text-info-strong',
  IN_PROGRESS: 'border-signal/30 bg-signal/10 text-signal-strong',
  ON_HOLD: 'border-warning/30 bg-warning/10 text-warning-strong',
  DONE: 'border-success/30 bg-success/10 text-success-strong',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
};

export const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const recordDate = (record: JournalRecord) => record.completedAt ?? record.scheduledAt ?? record.createdAt;

export const scoreTone = (score: number | null | undefined) => {
  if (typeof score !== 'number') return 'text-muted-foreground';
  return healthScoreColor(score);
};

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/30',
        active
          ? 'border-signal/30 bg-signal/10 text-signal-strong'
          : 'border-border bg-card text-muted-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

export function JournalRow({ record }: { record: JournalRecord }) {
  const isInspection = isInspectionRecord(record);
  // Ремонтная запись ведёт на свою заявку, а не в общий список: страница
  // /admin/maintenance/[id] существует, но ссылка на неё не строилась.
  const href = isInspection && record.inspection
    ? `/inspections/${record.inspection.id}`
    : `/admin/maintenance/${record.id}`;
  const score = record.inspection?.healthScore;
  const staleDays = staleOpenOrderDays(record);

  return (
    <tr className="align-top hover:bg-signal/10/30">
      <td className="px-3 py-3 font-mono text-xs text-foreground">
        <div>{fmtDate(recordDate(record))}</div>
        <div className="mt-1 text-2xs text-muted-foreground">{dueText(record.scheduledAt)}</div>
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex rounded border px-2 py-1 text-2xs font-semibold', TYPE_STYLE[record.type] ?? TYPE_STYLE.INSPECTION)}>
          {TYPE_LABEL[record.type] ?? record.type}
        </span>
      </td>
      <td className="px-3 py-3">
        <Link href={href} className="font-semibold text-foreground hover:text-signal-strong">
          {record.title}
        </Link>
        <div className="mt-1 text-xs text-muted-foreground">
          {isInspection ? 'чек-лист / доказательная запись' : 'наряд / ремонтная запись'}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-sm text-foreground">
        {record.engineHoursAtService != null ? `${record.engineHoursAtService} м.ч.` : '—'}
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-muted px-2 font-mono text-sm font-bold', scoreTone(score))}>
          {typeof score === 'number' ? score : '—'}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className={cn('inline-flex rounded border px-2 py-1 text-2xs font-semibold', STATUS_STYLE[record.status] ?? STATUS_STYLE.PLANNED)}>
          {STATUS_LABEL[record.status] ?? record.status}
        </span>
        {staleDays != null && (
          <div className="mt-1">
            <span className="inline-flex rounded border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-2xs font-semibold text-destructive-strong">
              просрочен · {staleDays} дн.
            </span>
          </div>
        )}
      </td>
    </tr>
  );
}

export function ChecklistBlock({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
      <Icon className="h-4 w-4 shrink-0 text-signal-strong" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success-strong" />
    </div>
  );
}

export function InfoLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm font-semibold text-foreground">
        <div className="truncate">{value}</div>
        {hint && <div className="mt-0.5 text-xs font-normal text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}

export function LoadingBlock({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={cn('grid place-items-center rounded-md bg-muted text-sm text-muted-foreground', tall ? 'h-56' : 'h-24')}>
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </span>
    </div>
  );
}

export function EmptyBlock({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={cn('grid place-items-center rounded-md bg-muted px-3 text-center text-sm text-muted-foreground', tall ? 'h-56' : 'min-h-20 py-4')}>
      {label}
    </div>
  );
}
