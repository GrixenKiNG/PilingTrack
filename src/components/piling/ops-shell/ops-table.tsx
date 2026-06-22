'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { OpsColumn } from './types';

/**
 * Generic dense journal table. Column headers hide below `lg` (cards-on-mobile is
 * each module's concern via the cell renderers). Rows are selectable and the
 * active row is highlighted — same interaction as the reports evidence journal.
 *
 * Column widths compose the CSS grid template, so all rows align to the header.
 */
export function OpsTable<T>({
  columns,
  rows,
  getRowId,
  activeId,
  onRowSelect,
  empty,
  footer,
}: {
  columns: OpsColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  activeId?: string | null;
  onRowSelect?: (row: T) => void;
  /** Shown instead of rows when `rows` is empty. */
  empty?: ReactNode;
  /** Optional footer area, e.g. a "load more" button. */
  footer?: ReactNode;
}) {
  // Drive the grid template via a CSS var so it only applies at `lg` (inline
  // styles can't be media-queried; the arbitrary `lg:[...]` class is purge-safe).
  const colsVar = { '--ops-cols': columns.map((c) => c.width).join(' ') } as React.CSSProperties;

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div
        className="hidden border-b border-slate-200 bg-slate-100/80 px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-slate-500 lg:grid lg:[grid-template-columns:var(--ops-cols)]"
        style={colsVar}
      >
        {columns.map((col) => (
          <span key={col.key} className={cn(col.align === 'right' && 'text-right')}>
            {col.header}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-16">{empty}</div>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {rows.map((row) => {
              const id = getRowId(row);
              const active = activeId === id;
              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onRowSelect?.(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onRowSelect?.(row);
                  }}
                  className={cn(
                    'grid cursor-pointer gap-3 px-3 py-3 text-sm outline-none transition-colors hover:bg-orange-50/30 lg:items-center lg:[grid-template-columns:var(--ops-cols)]',
                    active && 'bg-orange-50/70 ring-1 ring-inset ring-orange-200',
                  )}
                  style={colsVar}
                >
                  {columns.map((col) => (
                    <div key={col.key} className={cn('min-w-0', col.align === 'right' && 'lg:text-right')}>
                      {col.cell(row)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {footer && (
            <div className="border-t border-slate-200 bg-slate-50/80 p-3 text-center">{footer}</div>
          )}
        </>
      )}
    </section>
  );
}

/** Standard empty state for any ops table. */
export function OpsTableEmpty({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
}) {
  return (
    <div className="grid place-items-center text-center">
      <Icon className="mb-3 h-12 w-12 text-slate-300" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
