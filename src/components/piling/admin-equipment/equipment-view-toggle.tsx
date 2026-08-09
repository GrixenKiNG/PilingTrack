'use client';

import { LayoutGrid, LayoutTemplate, List } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';

export type FleetView = 'tiles' | 'table' | 'layout';

const VIEWS: Array<{ id: FleetView; label: string; icon: typeof LayoutGrid }> = [
  { id: 'tiles', label: 'Плитки', icon: LayoutGrid },
  { id: 'table', label: 'Таблица', icon: List },
  { id: 'layout', label: 'Конструктор', icon: LayoutTemplate },
];

export function EquipmentViewToggle({
  view,
  onChange,
}: {
  view: FleetView;
  onChange: (v: FleetView) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
      {VIEWS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            view === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}
