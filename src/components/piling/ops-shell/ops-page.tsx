'use client';

import { useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Two-column operational screen layout: a flexible main column and a resizable
 * right detail panel that becomes sticky on wide viewports. Pass the detail
 * panel as `aside`; drag its left edge to resize (same pattern as
 * admin-dictionaries / admin-equipment).
 *
 * `header` и `kpi` идут во всю ширину страницы, НАД колонками: внутри левой
 * колонки KPI-бар делил место с панелью (~840px), и плитки в один ряд
 * схлопывались до ~130px — иконка с подписью не помещались.
 */
export function OpsPage({
  header,
  kpi,
  aside,
  children,
}: {
  header: ReactNode;
  kpi?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [panelWidth, setPanelWidth] = useState(520);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = panelWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setPanelWidth(Math.min(720, Math.max(320, startW + (startX - moveEvent.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="min-h-full space-y-4 bg-slate-50/60 p-4 lg:p-6">
      {header}
      {kpi}
      <div
        style={{ '--panel-w': `${panelWidth}px` } as CSSProperties}
        className="grid grid-cols-1 gap-4 xl:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]"
      >
        <div className="min-w-0 space-y-4">{children}</div>
        {aside && (
          <div className="relative min-w-0">
            {/* Потяните за левый край, чтобы изменить ширину панели. */}
            <div
              onMouseDown={startResize}
              title="Потяните, чтобы изменить ширину"
              className="absolute -left-2.5 top-0 z-10 hidden h-full w-2.5 cursor-col-resize xl:block"
            >
              <div className="mx-auto h-full w-px bg-slate-200 transition-colors hover:bg-blue-400" />
            </div>
            {aside}
          </div>
        )}
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
