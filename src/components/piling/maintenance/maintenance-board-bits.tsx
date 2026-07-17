'use client';

/**
 * Мелкие переиспользуемые кирпичи журнала ТО: KPI-плитка, чип быстрого
 * фильтра, иконка-действие. Выделено из maintenance-board.tsx (аудит A-8).
 */

import Link from 'next/link';
import { type LucideIcon } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';

export function KpiCard({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string | number; tone: 'blue' | 'amber' | 'red' | 'green' }) {
  const toneClass = {
    blue: 'text-blue-600',
    amber: 'text-orange-500',
    red: 'text-red-500',
    green: 'text-emerald-600',
  }[tone];

  return (
    <div className="flex h-[78px] items-center gap-4 rounded-lg border border-slate-200 bg-white px-4">
      <Icon className={cn('h-8 w-8 shrink-0', toneClass)} strokeWidth={1.8} />
      <div>
        <div className="font-mono text-2xl font-bold text-slate-950">{value}</div>
        <div className="text-xs text-slate-600">{label}</div>
      </div>
    </div>
  );
}

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
