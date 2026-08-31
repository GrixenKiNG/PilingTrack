'use client';

import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';

/**
 * Части экрана машиниста.
 *
 * Оформление — токены продукта: `bg-card`, `border-border`, семантические
 * success/warning/destructive и бренд-оранжевый `signal` на первичном действии.
 * Отличие от остального приложения одно и намеренное: цель нажатия не меньше
 * 44 точек, а у главной кнопки — 48. Экран держат в перчатке на морозе, и
 * кнопка высотой 36 точек, нормальная для мыши, здесь промахивается.
 */

export function Screen({title, subtitle, children, footer}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b px-4 pb-3 pt-3">
        <h1 className="text-2xl font-bold leading-tight tracking-tight text-balance">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      <main className="flex-1 space-y-3 px-4 py-4 pb-40">{children}</main>
      {footer ? (
        <div className="sticky bottom-0 space-y-2 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function BigButton({children, onClick, disabled, tone = 'primary', type = 'button'}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-h-12 w-full rounded-lg border px-4 text-base font-semibold shadow-xs transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'primary' && 'border-signal bg-signal text-white hover:bg-signal-strong',
        tone === 'ghost' && 'bg-card text-foreground hover:bg-secondary',
        tone === 'danger' && 'border-destructive bg-destructive text-white hover:bg-destructive-strong',
      )}
    >
      {children}
    </button>
  );
}

export type PanelTone = 'plain' | 'ok' | 'warning' | 'danger';

export function Panel({children, tone = 'plain', className}: {
  children: ReactNode;
  tone?: PanelTone;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-lg border bg-card p-4 shadow-xs',
        tone === 'ok' && 'border-success/45 bg-success/8',
        tone === 'warning' && 'border-warning/50 bg-warning/10',
        tone === 'danger' && 'border-destructive/45 bg-destructive/8',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelTitle({children, tone = 'plain'}: {children: ReactNode; tone?: PanelTone}) {
  return (
    <h2
      className={cn(
        'text-base font-semibold leading-snug tracking-tight',
        tone === 'ok' && 'text-success-strong',
        tone === 'warning' && 'text-warning-strong',
        tone === 'danger' && 'text-destructive-strong',
      )}
    >
      {children}
    </h2>
  );
}

/** Строка «показатель — значение». Значение крупнее подписи и моноширинное. */
export function Fact({label, value, unit}: {label: string; value: ReactNode; unit?: string}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="text-base font-semibold tabular-nums">{value}</span>
        {unit ? <span className="ml-1 text-2xs text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

/** Объём работ в двух единицах сразу: штуки и метры погонные. */
export function VolumeFact({label, count, meters}: {label: string; count: number; meters: number}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">
        <span className="text-base font-semibold">{count}</span>
        <span className="ml-1 text-2xs text-muted-foreground">шт</span>
        <span className="mx-1.5 text-muted-foreground">·</span>
        <span className="text-base font-semibold">{meters.toFixed(1)}</span>
        <span className="ml-1 text-2xs text-muted-foreground">м.п.</span>
      </span>
    </div>
  );
}

export function PhaseBar({progress}: {
  progress: {phase: string; label: string; done: boolean; current: boolean}[];
}) {
  const current = progress.find((step) => step.current);
  return (
    <div className="bg-background px-4 pt-3">
      <ol className="flex gap-1" aria-label="Ход смены">
        {progress.map((step) => (
          <li
            key={step.phase}
            className={cn(
              'h-1 flex-1 rounded-full',
              step.done && 'bg-success',
              step.current && 'bg-signal',
              !step.done && !step.current && 'bg-border',
            )}
          />
        ))}
      </ol>
      <p className="mt-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
        {current?.label ?? ''}
      </p>
    </div>
  );
}

export function ErrorNote({message}: {message: string | null}) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/45 bg-destructive/8 p-3 text-sm font-medium text-destructive-strong">
      {message}
    </p>
  );
}

/** Кружок со знаком: цвет читают не все, галочку и восклицательный знак — все. */
export function Sign({tone}: {tone: 'ok' | 'warning' | 'danger'}) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white',
        tone === 'ok' && 'bg-success',
        tone === 'warning' && 'bg-warning text-warning-foreground',
        tone === 'danger' && 'bg-destructive',
      )}
    >
      {tone === 'ok' ? '✓' : tone === 'warning' ? '!' : '✕'}
    </span>
  );
}
