/**
 * Quick Pile Counter — Mobile-Optimized Component
 *
 * Large buttons for field use:
 * - +1, +5, +10, -1 quick increment/decrement
 * - Big touch targets (min 48px)
 * - Visual feedback on press
 * - Works offline (IndexedDB)
 */

'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Minus, Check } from 'lucide-react';

interface QuickPileCounterProps {
  gradeId: string;
  gradeName: string;
  initialCount?: number;
  onChange: (gradeId: string, count: number) => void;
  disabled?: boolean;
}

export function QuickPileCounter({
  gradeId,
  gradeName,
  initialCount = 0,
  onChange,
  disabled = false,
}: QuickPileCounterProps) {
  const [count, setCount] = useState(initialCount);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const update = useCallback((delta: number) => {
    const newCount = Math.max(0, count + delta);
    setCount(newCount);
    onChange(gradeId, newCount);

    const label = delta > 0 ? `+${delta}` : `${delta}`;
    setLastAction(label);
    setTimeout(() => setLastAction(null), 500);
  }, [count, gradeId, onChange]);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{gradeName}</span>
        <motion.span
          key={lastAction}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-xs text-muted-foreground"
        >
          {lastAction}
        </motion.span>
      </div>

      {/* Counter Display */}
      <div className="flex items-center justify-center py-4">
        <motion.span
          key={count}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="text-5xl font-bold tabular-nums"
        >
          {count}
        </motion.span>
      </div>

      {/* Quick Buttons */}
      <div className="grid grid-cols-4 gap-2">
        <QuickButton label="-1" icon={<Minus className="h-5 w-5" />} onClick={() => update(-1)} disabled={disabled || count === 0} variant="destructive" />
        <QuickButton label="+1" icon={<Plus className="h-5 w-5" />} onClick={() => update(1)} disabled={disabled} />
        <QuickButton label="+5" onClick={() => update(5)} disabled={disabled} />
        <QuickButton label="+10" onClick={() => update(10)} disabled={disabled} variant="secondary" />
      </div>
    </div>
  );
}

interface QuickButtonProps {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'secondary' | 'destructive';
}

function QuickButton({ label, icon, onClick, disabled, variant = 'default' }: QuickButtonProps) {
  const variantClasses: Record<string, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.95 }}
      className={`
        flex flex-col items-center justify-center
        min-h-[56px] rounded-lg font-medium text-sm
        transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]}
      `}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
    </motion.button>
  );
}
