/**
 * Quick Downtime Selector — Mobile-Optimized
 *
 * Large touch targets for selecting downtime reasons in the field.
 */

'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Plus, Minus } from 'lucide-react';

interface QuickDowntimeSelectorProps {
  reasons: Array<{ id: string; name: string }>;
  onAdd: (reasonId: string, duration: number) => void;
  disabled?: boolean;
}

export function QuickDowntimeSelector({ reasons, onAdd, disabled }: QuickDowntimeSelectorProps) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [duration, setDuration] = useState(30); // Default 30 min

  const handleAdd = () => {
    if (!selectedReason) return;
    onAdd(selectedReason, duration);
    setDuration(30);
    setSelectedReason(null);
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Clock className="h-4 w-4" /> Простой
      </h3>

      {/* Reason Selection */}
      <div className="grid grid-cols-2 gap-2">
        {reasons.map((reason) => (
          <motion.button
            key={reason.id}
            type="button"
            onClick={() => setSelectedReason(reason.id)}
            whileTap={{ scale: 0.95 }}
            className={`
              min-h-[48px] rounded-lg px-3 py-2 text-sm font-medium
              transition-colors text-left
              ${selectedReason === reason.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'}
            `}
          >
            {reason.name}
          </motion.button>
        ))}
      </div>

      {/* Duration Selector */}
      {selectedReason && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Длительность</span>
            <span className="text-2xl font-bold tabular-nums">{duration} мин</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <DurationButton label="-30" onClick={() => setDuration(Math.max(5, duration - 30))} icon={<Minus className="h-4 w-4" />} />
            <DurationButton label="+15" onClick={() => setDuration(duration + 15)} />
            <DurationButton label="+30" onClick={() => setDuration(duration + 30)} />
            <DurationButton label="+60" onClick={() => setDuration(duration + 60)} variant="secondary" />
          </div>

          {/* Quick presets */}
          <div className="flex gap-2">
            {[15, 30, 60, 120].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setDuration(mins)}
                className={`
                  flex-1 min-h-[40px] rounded text-xs font-medium
                  transition-colors
                  ${duration === mins ? 'bg-primary text-primary-foreground' : 'bg-muted'}
                `}
              >
                {mins}м
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={disabled}
            className="w-full min-h-[56px] rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            Добавить простой
          </button>
        </motion.div>
      )}
    </div>
  );
}

function DurationButton({ label, onClick, icon, variant = 'default' }: { label: string; onClick: () => void; icon?: React.ReactNode; variant?: string }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={`
        min-h-[48px] rounded-lg flex flex-col items-center justify-center text-sm font-medium
        ${variant === 'secondary' ? 'bg-secondary text-secondary-foreground' : 'bg-muted hover:bg-muted/80'}
      `}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
    </motion.button>
  );
}
