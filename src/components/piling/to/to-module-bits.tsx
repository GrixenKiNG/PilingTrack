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
  EO: 'border-slate-200 bg-slate-50 text-slate-700',
  TO1: 'border-blue-200 bg-blue-50 text-blue-700',
  TO2: 'border-blue-200 bg-blue-50 text-blue-700',
  TO3: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  SEASONAL: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  REPAIR: 'border-rose-200 bg-rose-50 text-rose-700',
  FAULT: 'border-amber-200 bg-amber-50 text-amber-700',
  SCHEDULED: 'border-blue-200 bg-blue-50 text-blue-700',
  INSPECTION: 'border-slate-200 bg-slate-50 text-slate-700',
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
  PLANNED: 'border-slate-200 bg-slate-50 text-slate-700',
  ASSIGNED: 'border-sky-200 bg-sky-50 text-sky-700',
  IN_PROGRESS: 'border-orange-200 bg-orange-50 text-orange-700',
  ON_HOLD: 'border-amber-200 bg-amber-50 text-amber-700',
  DONE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-400',
};

export const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const recordDate = (record: JournalRecord) => record.completedAt ?? record.scheduledAt ?? record.createdAt;

export const scoreTone = (score: number | null | undefined) => {
  if (typeof score !== 'number') return 'text-slate-400';
  return healthScoreColor(score);
};

export function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
        active
          ? 'border-orange-200 bg-orange-50 text-orange-700'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

export function JournalRow({ record }: { record: JournalRecord }) {
  const isInspection = isInspectionRecord(record);
  const href = isInspection && record.inspection ? `/inspections/${record.inspection.id}` : '/admin/maintenance';
  const score = record.inspection?.healthScore;
  const staleDays = staleOpenOrderDays(record);

  return (
    <tr className="align-top hover:bg-orange-50/30">
      <td className="px-3 py-3 font-mono text-xs text-slate-700">
        <div>{fmtDate(recordDate(record))}</div>
        <div className="mt-1 text-2xs text-slate-400">{dueText(record.scheduledAt)}</div>
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex rounded border px-2 py-1 text-2xs font-semibold', TYPE_STYLE[record.type] ?? TYPE_STYLE.INSPECTION)}>
          {TYPE_LABEL[record.type] ?? record.type}
        </span>
      </td>
      <td className="px-3 py-3">
        <Link href={href} className="font-semibold text-slate-900 hover:text-orange-600">
          {record.title}
        </Link>
        <div className="mt-1 text-xs text-slate-500">
          {isInspection ? 'чек-лист / доказательная запись' : 'наряд / ремонтная запись'}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-sm text-slate-800">
        {record.engineHoursAtService != null ? `${record.engineHoursAtService} м.ч.` : '—'}
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-50 px-2 font-mono text-sm font-bold', scoreTone(score))}>
          {typeof score === 'number' ? score : '—'}
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className={cn('inline-flex rounded border px-2 py-1 text-2xs font-semibold', STATUS_STYLE[record.status] ?? STATUS_STYLE.PLANNED)}>
          {STATUS_LABEL[record.status] ?? record.status}
        </span>
        {staleDays != null && (
          <div className="mt-1">
            <span className="inline-flex rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-2xs font-semibold text-rose-700">
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
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
      <Icon className="h-4 w-4 shrink-0 text-orange-500" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
    </div>
  );
}

export function InfoLine({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="min-w-0 text-sm font-semibold text-slate-800">
        <div className="truncate">{value}</div>
        {hint && <div className="mt-0.5 text-xs font-normal text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

export function LoadingBlock({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={cn('grid place-items-center rounded-md bg-slate-50 text-sm text-slate-400', tall ? 'h-56' : 'h-24')}>
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> {label}
      </span>
    </div>
  );
}

export function EmptyBlock({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div className={cn('grid place-items-center rounded-md bg-slate-50 px-3 text-center text-sm text-slate-500', tall ? 'h-56' : 'min-h-20 py-4')}>
      {label}
    </div>
  );
}
