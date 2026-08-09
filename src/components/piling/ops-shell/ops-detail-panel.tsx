'use client';

import type { ComponentType, ReactNode } from 'react';
import { History, X } from '@/components/piling/icons/unified-icons';

/**
 * Right-hand detail panel shell. Sticky on wide viewports. The body is whatever
 * the module renders (facts, metrics, photos, actions). Use `OpsDetailEmpty` for
 * the no-selection state, `OpsFact`/`OpsHistoryList` for common building blocks.
 */
export function OpsDetailPanel({
  title,
  subtitle,
  status,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  /** A status/risk badge node, shown under the subtitle. */
  status?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="self-start rounded-lg border border-border bg-card shadow-sm xl:sticky xl:top-4">
      <div className="border-b border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
            {subtitle && <p className="mt-0.5 text-2xs text-muted-foreground">{subtitle}</p>}
            {status && <div className="mt-1">{status}</div>}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Закрыть панель"
              title="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </aside>
  );
}

/** Placeholder shown in the right column when nothing is selected. */
export function OpsDetailEmpty({ message }: { message: string }) {
  return (
    <aside className="min-h-56 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground shadow-sm xl:sticky xl:top-4">
      {message}
    </aside>
  );
}

/** A small labelled fact cell. Group several inside a bordered/divided row. */
export function OpsFact({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 p-2">
      <p className="mb-0.5 text-3xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="truncate text-xs font-semibold text-foreground">{value}</div>
      {sub && <p className="mt-0.5 truncate text-3xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export interface OpsHistoryEntry {
  id: string;
  title: string;
  meta?: string;
  at: string;
  changes?: Array<{ label: string; before: string; after: string }>;
}

/**
 * Change-history list. Feed it normalized entries (from AuditLog / report history
 * / inspection history). Handles loading / error / empty consistently.
 */
export function OpsHistoryList({
  entries,
  loading,
  error,
  icon: Icon = History,
  title = 'История изменений',
}: {
  entries: OpsHistoryEntry[] | null;
  loading?: boolean;
  error?: boolean;
  icon?: ComponentType<{ className?: string }>;
  title?: string;
}) {
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h3>
      <div className="rounded-md border border-border">
        {loading ? (
          <div className="px-2.5 py-3 text-2xs text-muted-foreground">Загрузка истории…</div>
        ) : error ? (
          <div className="px-2.5 py-3 text-2xs text-red-500">Не удалось загрузить историю</div>
        ) : !entries || entries.length === 0 ? (
          <div className="px-2.5 py-3 text-2xs text-muted-foreground">Событий пока нет</div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="border-b border-border px-2.5 py-2 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{entry.title}</span>
                <span className="text-3xs text-muted-foreground">{entry.at}</span>
              </div>
              {entry.meta && <p className="mt-0.5 text-2xs text-muted-foreground">{entry.meta}</p>}
              {entry.changes && entry.changes.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {entry.changes.map((change, i) => (
                    <li key={i} className="text-2xs text-muted-foreground">
                      <span className="text-muted-foreground">{change.label}:</span>{' '}
                      <span className="line-through decoration-slate-300">{change.before}</span>
                      {' → '}
                      <span className="font-medium text-foreground">{change.after}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
