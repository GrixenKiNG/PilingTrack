'use client';

import type React from 'react';
import { KPI_GRID, KpiTile, kpiGridStyle } from '@/components/piling/kpi-tile';
import type { PilingIconName } from '@/components/piling/icons';
import { cn } from '@/lib/utils';

/** Базовая карточка модуля: одна константа на все экраны техготовности. */
export const card = 'rounded-[14px] border border-border bg-card shadow-sm';

export const COMPACT_KPI_GRID = cn(
  KPI_GRID,
  '[&>*]:!min-h-[76px] [&>*]:!rounded-[10px] [&>*]:!p-3 max-sm:!grid-cols-1',
);

export function ScreenTitle({
  heading,
  subtitle,
  actions,
}: {
  heading: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[58px] flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:py-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{heading}</h1>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface SettingsKpiItem {
  icon: PilingIconName;
  label: string;
  value: React.ReactNode;
  detail?: string;
  alert?: boolean;
}

export function SettingsKpis({ items }: { items: SettingsKpiItem[] }) {
  return (
    <section className={COMPACT_KPI_GRID} style={kpiGridStyle(items.length)}>
      {items.map((item) => <KpiTile key={item.label} {...item} />)}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  label = 'Переключатель',
  icon,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled || !onChange}
      onClick={() => onChange?.(!checked)}
      className="grid min-h-11 min-w-11 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
    >
      <span className={cn('relative block h-5 w-9 rounded-full transition', checked ? 'bg-success-strong' : 'bg-border')}>
        <span className={cn('absolute top-0.5 grid h-4 w-4 place-items-center rounded-full bg-background shadow transition', checked ? 'left-[18px] text-success-strong' : 'left-0.5 text-muted-foreground')}>{icon}</span>
      </span>
    </button>
  );
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return <div><div className="text-3xs text-muted-foreground">{label}</div><div className="mt-0.5 font-semibold text-foreground">{value}</div></div>;
}

/** Пилюля статуса: один вид на все разделы настроек. */
export function StatusPill({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: React.ReactNode }) {
  const tones = {
    success: 'border-success/25 bg-success/10 text-success-strong',
    warning: 'border-warning/25 bg-warning/10 text-warning-strong',
    danger: 'border-destructive/25 bg-destructive/10 text-destructive-strong',
    info: 'border-info/25 bg-info/10 text-info-strong',
    neutral: 'border-border bg-muted text-muted-foreground',
  } as const;
  return <span className={cn('inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-3xs font-semibold', tones[tone])}>{children}</span>;
}
