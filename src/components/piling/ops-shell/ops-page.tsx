'use client';

import type { ComponentType, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Two-column operational screen layout: a flexible main column and a fixed-width
 * right detail panel that becomes sticky on wide viewports. Mirrors the proven
 * admin-reports layout. Pass the detail panel as `aside`.
 */
export function OpsPage({
  header,
  aside,
  children,
}: {
  header: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full bg-slate-50/60 p-4 lg:p-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_520px] 2xl:grid-cols-[minmax(0,1fr)_560px]">
        <div className="min-w-0 space-y-4">
          {header}
          {children}
        </div>
        {aside}
      </div>
    </div>
  );
}

/**
 * Screen header: icon + title, an optional count badge, a one-line purpose
 * sub-title (the "что происходит" framing), and right-aligned action buttons.
 */
export function OpsHeader({
  icon: Icon,
  title,
  countLabel,
  subtitle,
  actions,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  countLabel?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-950">
            <Icon className="h-5 w-5 text-orange-500" />
            {title}
          </h1>
          {countLabel && (
            <Badge variant="outline" className="border-slate-300 bg-white font-mono text-3xs text-slate-500">
              {countLabel}
            </Badge>
          )}
        </div>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
