'use client';

/**
 * Типы источников, тона и презентационные плитки штаба диспетчера
 * (KPI, план-факт, установка, риски, секция). Выделено из
 * admin-dashboard.tsx (аудит A-8: файл был 599 строк).
 */

import { type ReactNode } from 'react';
import { type LucideIcon } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import type { SiteAnalyticsDTO } from '@/lib/types';

// ── Shapes of the read-only sources (decoupled, like maintenance-board) ──
export type FleetStatus = 'active' | 'expected' | 'idle';
export interface FleetCard {
  id: string; name: string; model: string; status: FleetStatus;
  assignedSiteName: string | null;
  assignedOperatorName: string | null;
  assignedCrewName: string | null;
  todaysReports?: number;
  todayTotals: { piles: number; drillingMeters: number; downtimeHours: number } | null;
  latestReport: { date: string; siteName: string | null; operatorName: string | null; updatedAt?: string } | null;
}
export interface FleetSnapshot {
  totals: { totalEquipment: number; activeToday: number; expected: number; idle: number; downtimeHoursToday: number; crewsOnShiftToday: number };
  equipment: FleetCard[];
}
export interface MaintRow {
  id: string; equipmentId: string; type: string; status: string; scheduledAt: string | null;
  equipment: { id: string; name: string; model: string | null } | null;
}
export interface RecentReport {
  id: string; reportId: string; date: string; shiftType: string; siteName: string; equipmentName: string; operatorName: string;
  crewName: string | null; status: string; hasPhoto: boolean; photoCount: number; edited: boolean; updatedAt: string;
}
export interface SiteOption { id: string; name: string }

export type Tone = 'danger' | 'warning' | 'info' | 'success' | 'muted';
export const TONE_TEXT: Record<Tone, string> = {
  danger: 'text-red-600', warning: 'text-amber-600', info: 'text-blue-600',
  success: 'text-emerald-600', muted: 'text-slate-400',
};
export const TONE_TAG: Record<Tone, string> = {
  danger: 'bg-red-50 text-red-700', warning: 'bg-amber-50 text-amber-700',
  info: 'bg-blue-50 text-blue-700', success: 'bg-emerald-50 text-emerald-700',
  muted: 'bg-slate-100 text-slate-500',
};

export interface Risk { id: string; tone: Tone; icon: LucideIcon; text: string; hint: string; href: string; rig?: string; site?: string | null }

type KpiTone = 'blue' | 'emerald' | 'teal' | 'amber' | 'violet' | 'red';

// Плитка дашборда — эталон вида KPI для всего приложения (см. KpiTile в
// components/piling/kpi-tile.tsx, который повторяет её в остальных модулях).
// Здесь она своя, потому что несёт ещё и прогресс-бар план/факт.
// `tone` оставлен в пропсах для наглядности вызова, но цвет не задаёт.
export function KpiTile({ icon, label, value, sub, progress }: {
  icon: PilingIconName; tone: KpiTone; label: string; value: ReactNode; sub?: string; progress?: number;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:border-orange-200 hover:shadow-md">
      {/* Иконка тянется во всю высоту плитки, описание — рядом. Высоту задаёт
          плитка (flex-1), а иконка позиционируется абсолютно, поэтому её
          собственный размер не раздувает плитку и не выходит за рамку.
          Ряд тянется на всю высоту — иначе иконки на плитках без прогресс-бара
          оказывались мельче соседних. */}
      <div className="flex flex-1 items-stretch gap-4">
        <span className="relative w-20 shrink-0 self-stretch">
          <PilingIcon name={icon} fill decorative className="absolute inset-0" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-600">{label}</div>
          {/* Составные значения («1 754 шт / 25 412 м.п.») не помещаются в строку
              рядом с крупной иконкой — переносим, а не обрезаем: описание должно
              читаться целиком. */}
          <div className="mt-1 font-mono text-xl font-semibold leading-tight text-balance break-words text-slate-900 2xl:text-2xl">{value}</div>
          {sub && <div className="mt-1 break-words text-xs text-slate-500">{sub}</div>}
          {progress != null && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-600" style={{ width: `${clampPct(progress)}%` }} />
              </div>
              <span className="font-mono text-xs text-slate-600">{Math.round(clampPct(progress))}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type MiniTone = 'emerald' | 'blue' | 'amber' | 'red';
const MINI_BAR: Record<MiniTone, string> = {
  emerald: 'bg-emerald-600',
  blue: 'bg-blue-600',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

export function PlanTile({ a }: { a: SiteAnalyticsDTO }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-900">{a.siteName}</span>
        <span className="shrink-0 text-2xs text-slate-500">{formatNumber(a.totalReports)} отч.</span>
      </div>
      <div>
        <div className="mb-0.5 text-2xs text-slate-500">Сваи · план {formatNumber(a.plannedPiles)} шт</div>
        <MiniProgress value={`${formatNumber(a.actualPiles)} шт / ${formatNumber(a.actualPileMeters)} м.п.`} pct={a.pileProgress} tone="emerald" />
      </div>
      <div>
        <div className="mb-0.5 text-2xs text-slate-500">Бурение · план {formatNumber(a.plannedDrilling)} м</div>
        <MiniProgress value={`${formatNumber(a.actualDrilling)} м / ${formatNumber(a.actualDrillingCount)} шт`} pct={a.drillingProgress} tone="blue" />
      </div>
    </div>
  );
}

export function RigTile({ r, status, onOpen }: { r: FleetCard; status: { tone: Tone; label: string }; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
          <div className="truncate text-2xs text-slate-500">{r.model || 'модель не указана'}</div>
        </div>
        <span className={cn('shrink-0 rounded px-2 py-0.5 text-2xs font-medium', TONE_TAG[status.tone])}>{status.label}</span>
      </div>
      <div className="truncate text-2xs text-slate-500">{r.assignedSiteName ?? 'объект не привязан'}</div>
      <div className="font-mono text-2xs text-slate-600">
        {r.todayTotals ? `${formatNumber(r.todayTotals.piles)} шт / ${formatNumber(r.todayTotals.drillingMeters)} м` : 'нет данных за сегодня'}
      </div>
      <div className="truncate text-2xs text-slate-500">
        {r.assignedOperatorName ?? r.latestReport?.operatorName ?? '—'}{r.assignedCrewName ? ` · ${r.assignedCrewName}` : ''}
      </div>
    </button>
  );
}

function MiniProgress({ value, pct, tone }: { value: string; pct: number; tone: MiniTone }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-mono text-xs text-slate-700">{value}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full', MINI_BAR[tone])} style={{ width: `${clampPct(pct)}%` }} />
      </div>
      <div className="mt-0.5 font-mono text-2xs text-slate-400">{Math.round(clampPct(pct))}%</div>
    </div>
  );
}

function clampPct(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function RiskGroup({ title, risks, onOpen }: { title: string; risks: Risk[]; onOpen: (href: string) => void }) {
  if (risks.length === 0) return null;

  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-2xs font-semibold uppercase text-slate-400">{title}</div>
      {risks.map((r) => {
        const Icon = r.icon;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r.href)}
            className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_TEXT[r.tone])} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-slate-900">{r.text}</span>
              <span className="block truncate text-2xs text-slate-500">{r.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Section({ icon: Icon, title, count, dominant, footerLabel, onFooter, children }: {
  icon: LucideIcon; title: string; count?: number; dominant?: boolean; footerLabel?: string; onFooter?: () => void; children: ReactNode;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-white', dominant ? 'border-red-200' : 'border-slate-200')}>
      <div className={cn('flex items-center gap-2 border-b px-3 py-2',
        dominant ? 'border-red-100 bg-red-50 text-red-700' : 'border-slate-200 text-slate-700')}>
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold">{title}</span>
        {count != null && (
          <span className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-2xs',
            dominant ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500',
          )}>
            {count}
          </span>
        )}
      </div>
      <div>{children}</div>
      {footerLabel && (
        <button
          type="button"
          onClick={onFooter}
          className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-blue-700 hover:bg-blue-50"
        >
          {footerLabel}
          <span aria-hidden="true">›</span>
        </button>
      )}
    </section>
  );
}

export function Empty({ text, tone = 'muted' }: { text: string; tone?: Tone }) {
  return <div className={cn('px-3 py-8 text-center text-2xs', TONE_TEXT[tone])}>{text}</div>;
}
