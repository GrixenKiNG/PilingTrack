'use client';

import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Honest placeholder for data we don't have yet (telemetry, errors, etc.).
 * When the hardware/source lands, only the data behind this slot changes —
 * not the layout. Never shows a fabricated number.
 */
export function EquipmentPlaceholder({
  label,
  hint = 'нет данных',
  className,
}: {
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-400',
        className,
      )}
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium text-slate-500">{label}</span>
      <span className="ml-auto">{hint}</span>
    </div>
  );
}
