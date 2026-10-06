'use client';

/**
 * Мелкие переиспользуемые кирпичи журнала ТО: чип быстрого фильтра,
 * иконка-действие. Выделено из maintenance-board.tsx (аудит A-8).
 * KPI-плитки — общий KpiTile из components/piling/kpi-tile.
 */

import Link from 'next/link';
import { type LucideIcon } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';

export function QuickChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // R73 (F-MOB-MAINT): чип быстрого фильтра был h-8 (32px) — на телефоне
        // ниже 44px. Видимая высота на десктопе прежняя (32px) за счёт sm:min-h-8.
        'min-h-11 rounded-md border px-3 text-xs font-medium transition-colors sm:min-h-8',
        active
          ? 'border-info/30 bg-info/10 text-info-strong'
          : 'border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

export function ActionIcon({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <Link
      href={href}
      onClick={(event) => event.stopPropagation()}
      className="inline-flex h-11 w-11 items-center justify-center rounded border border-border text-muted-foreground hover:bg-signal/10 hover:text-signal-strong"
      aria-label={label}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Link>
  );
}
