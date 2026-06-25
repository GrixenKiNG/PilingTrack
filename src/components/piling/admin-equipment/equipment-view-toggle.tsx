'use client';

import { LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FleetView = 'tiles' | 'table';

export function EquipmentViewToggle({
  view,
  onChange,
}: {
  view: FleetView;
  onChange: (v: FleetView) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      <button
        onClick={() => onChange('tiles')}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          view === 'tiles' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
        )}
      >
        <LayoutGrid className="h-3.5 w-3.5" /> Плитки
      </button>
      <button
        onClick={() => onChange('table')}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          view === 'table' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
        )}
      >
        <List className="h-3.5 w-3.5" /> Таблица
      </button>
    </div>
  );
}
