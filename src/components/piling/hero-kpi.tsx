'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface HeroKpiProps {
  label: string;
  value: ReactNode;        // e.g. "76" or a formatted node
  unit?: string;           // e.g. "%", "шт", "ч"
  detail?: ReactNode;      // small line under the value
  icon?: LucideIcon;
  action?: ReactNode;      // optional button rendered top-right
  variant?: 'orange' | 'neutral';
}

/**
 * Dominant KPI card used as a page hero.
 * Orange gradient = primary brand action surface.
 * Neutral = secondary/quieter pages.
 */
export function HeroKpi({
  label, value, unit, detail, icon: Icon, action, variant = 'orange',
}: HeroKpiProps) {
  const isOrange = variant === 'orange';
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card
        className={
          isOrange
            ? 'overflow-hidden border-0 bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/20'
            : 'overflow-hidden border bg-card'
        }
      >
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className={isOrange ? 'text-sm font-medium text-white/80' : 'text-sm font-medium text-muted-foreground'}>
                {label}
              </p>
              <div className="mt-2 flex items-baseline gap-3">
                <span
                  className={
                    'font-mono text-6xl font-bold tabular-nums leading-none ' +
                    (isOrange ? 'text-white' : 'text-foreground')
                  }
                >
                  {value}
                </span>
                {unit && (
                  <span className={isOrange ? 'text-2xl font-semibold text-white/80' : 'text-2xl font-semibold text-muted-foreground'}>
                    {unit}
                  </span>
                )}
              </div>
              {detail && (
                <div className={'mt-3 ' + (isOrange ? 'text-sm text-white/85' : 'text-sm text-muted-foreground')}>
                  {detail}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-3 flex-shrink-0">
              {Icon && (
                <span
                  className={
                    'flex h-14 w-14 items-center justify-center rounded-xl ' +
                    (isOrange ? 'bg-white/15 backdrop-blur' : 'bg-muted')
                  }
                >
                  <Icon className={'h-7 w-7 ' + (isOrange ? 'text-white' : 'text-muted-foreground')} />
                </span>
              )}
              {action}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
