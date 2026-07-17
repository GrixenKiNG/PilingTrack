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
        'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
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
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-orange-50 hover:text-orange-600"
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
    </Link>
  );
}
