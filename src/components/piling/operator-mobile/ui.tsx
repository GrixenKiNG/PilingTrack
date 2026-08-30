'use client';

import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';

/**
 * Мелкие части экрана оператора.
 *
 * ПОЧЕМУ НЕ ОБЩИЕ КОМПОНЕНТЫ ПРОДУКТА. Те рассчитаны на мышь и монитор в
 * конторе: кнопка высотой 36 точек, подписи серым по светло-серому. На
 * площадке экран держат в перчатке, а солнце по снегу гасит любой оттенок
 * серого. Отсюда собственный набор: цель нажатия не меньше 60 точек,
 * состояние обозначено цветом и словом одновременно — цвета на морозе через
 * поляризационные очки не всегда видно.
 */

export function Screen({title, subtitle, children, footer}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-neutral-900">
      <header className="border-b-2 border-neutral-900 px-4 pb-3 pt-4">
        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-base text-neutral-600">{subtitle}</p> : null}
      </header>
      <main className="flex-1 space-y-4 px-4 py-4 pb-40">{children}</main>
      {footer ? (
        <div className="sticky bottom-0 border-t-2 border-neutral-900 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
  tone?: 'primary' | 'danger' | 'ghost';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-h-[60px] w-full rounded-2xl px-5 text-lg font-bold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'primary' && 'bg-neutral-900 text-white active:bg-neutral-700',
        tone === 'danger' && 'bg-red-700 text-white active:bg-red-800',
        tone === 'ghost' && 'border-2 border-neutral-900 bg-white text-neutral-900 active:bg-neutral-100',
      )}
    >
      {children}
    </button>
  );
}

export function Panel({children, tone = 'plain', className}: {
  children: ReactNode;
  tone?: 'plain' | 'warning' | 'stop' | 'ok';
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border-2 p-4',
        tone === 'plain' && 'border-neutral-300 bg-white',
        tone === 'ok' && 'border-emerald-700 bg-emerald-50',
        tone === 'warning' && 'border-amber-600 bg-amber-50',
        tone === 'stop' && 'border-red-700 bg-red-50',
        className,
      )}
    >
      {children}
    </section>
  );
}

/** Строка «показатель — значение». Значение всегда крупнее подписи. */
export function Fact({label, value, hint}: {label: string; value: ReactNode; hint?: string}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-neutral-200 py-2 last:border-b-0">
      <span className="text-base text-neutral-600">{label}</span>
      <span className="text-right">
        <span className="text-xl font-bold tabular-nums">{value}</span>
        {hint ? <span className="ml-1 text-sm text-neutral-500">{hint}</span> : null}
      </span>
    </div>
  );
}

export function PhaseBar({progress}: {
  progress: {phase: string; label: string; done: boolean; current: boolean}[];
}) {
  return (
    <ol className="flex gap-1 px-4 pt-3" aria-label="Ход смены">
      {progress.map((step) => (
        <li key={step.phase} className="flex-1">
          <div
            className={cn(
              'h-2 rounded-full',
              step.done && 'bg-emerald-600',
              step.current && 'bg-neutral-900',
              !step.done && !step.current && 'bg-neutral-200',
            )}
          />
          {step.current ? (
            <p className="mt-1 truncate text-xs font-semibold text-neutral-900">{step.label}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ErrorNote({message}: {message: string | null}) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border-2 border-red-700 bg-red-50 p-3 text-base font-semibold text-red-900">
      {message}
    </p>
  );
}
