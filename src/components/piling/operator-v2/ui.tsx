'use client';

/**
 * Обвязка экранов модуля-кандидата — ровно та, что на макете владельца.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ НАБОР, А НЕ ОБЩИЕ КОМПОНЕНТЫ ПРОДУКТА. Макет задаёт свой
 * язык: цветная шапка шага, плоский список строк с галочкой справа, одна синяя
 * кнопка внизу. Это НЕ действующая палитра PilingTrack (там оранжевый
 * `--signal`), и подмешивать её сюда нельзя: смысл модуля в том, чтобы владелец
 * увидел макет как есть и сравнил с текущим экраном. Если выбор падёт сюда —
 * цвет приводится к бренду отдельным решением.
 */

import type { ReactNode } from 'react';
import { Check, ChevronLeft } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';

/** Цвет шапки шага. На макете синий у рабочих шагов, зелёный у пуска, фиолетовый у закрытия. */
export type StepTone = 'blue' | 'green' | 'purple';

const TONE_BAR: Record<StepTone, string> = {
  blue: 'bg-[#1e5bd6]',
  green: 'bg-[#12a150]',
  purple: 'bg-[#7c3aed]',
};

const TONE_BUTTON: Record<StepTone, string> = {
  blue: 'bg-[#1e5bd6]',
  green: 'bg-[#12a150]',
  purple: 'bg-[#7c3aed]',
};

/** Экран шага: цветная шапка, содержимое, кнопка внизу. */
export function StepShell({
  title, subtitle, tone = 'blue', onBack, children, footer,
}: {
  title: string;
  subtitle?: string;
  tone?: StepTone;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    // Высота НЕ прибита к 100dvh. Оболочка приложения рисует свою шапку над
    // модулем, поэтому экран на её высоту выше окна: кнопка внизу уезжала за
    // край, и нажать её было нельзя. Здесь высота по содержимому, а кнопка
    // прилипает к нижней границе окна — она достижима и на длинном списке
    // осмотра, и на коротком экране пуска.
    <div className="mx-auto w-full max-w-md bg-background">
      <header className={cn('flex items-center gap-2 px-3 py-3 text-white', TONE_BAR[tone])}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Назад"
            className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15">
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : <span className="w-7" />}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">{title}</p>
          {subtitle && <p className="truncate text-xs text-white/85">{subtitle}</p>}
        </div>
      </header>

      <div className="space-y-3 p-4">{children}</div>

      {footer && (
        <div className="sticky bottom-0 z-20 border-t border-border bg-card p-3 pb-safe">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Единственная кнопка внизу — как на макете. */
export function StepButton({
  label, onClick, disabled, busy, tone = 'blue',
}: {
  label: string; onClick: () => void; disabled?: boolean; busy?: boolean; tone?: StepTone;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'flex min-h-12 w-full items-center justify-center rounded-lg text-base font-semibold text-white transition active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
        TONE_BUTTON[tone],
      )}
    >
      {busy ? 'Секунду…' : label}
    </button>
  );
}

/**
 * Строка чек-листа: название слева, отметка справа.
 *
 * Одно касание по всей строке — «в норме». Так на макете: там нет ни выпадающих
 * списков, ни пары кнопок на каждый пункт, и на солнце в перчатке это
 * единственное, что работает.
 */
export function CheckRow({
  label, hint, checked, onToggle, right,
}: {
  label: string;
  hint?: string;
  checked?: boolean;
  onToggle?: () => void;
  /** Своё содержимое справа вместо галочки — например поле замера. */
  right?: ReactNode;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-foreground">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {right ?? (
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-[#12a150] bg-[#12a150] text-white' : 'border-border')}>
          {checked && <Check className="h-4 w-4" />}
        </span>
      )}
    </>
  );

  if (!onToggle) {
    return <div className="flex min-h-12 items-center gap-3 px-3">{content}</div>;
  }
  return (
    <button type="button" onClick={onToggle} aria-pressed={Boolean(checked)}
      className="flex min-h-12 w-full items-center gap-3 px-3 text-left active:bg-muted/60">
      {content}
    </button>
  );
}

/** Список строк в рамке — как блоки на макете. */
export function RowList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {children}
    </ul>
  );
}

/** Пара «подпись — значение» для сводок (отчёт, приёмка). */
export function ValueRow({ label, value, tone }: {
  label: string; value: string; tone?: 'ok' | 'warn';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold',
        tone === 'ok' ? 'text-[#12a150]'
          : tone === 'warn' ? 'text-warning-strong' : 'text-foreground')}>{value}</span>
    </div>
  );
}

/** Большой круг с галочкой — экраны пуска и закрытия смены. */
export function BigCheck({ tone }: { tone: 'green' | 'purple' }) {
  return (
    <div className={cn('mx-auto flex h-24 w-24 items-center justify-center rounded-full',
      tone === 'green' ? 'bg-[#12a150]/12' : 'bg-[#7c3aed]/12')}>
      <div className={cn('flex h-16 w-16 items-center justify-center rounded-full border-[3px]',
        tone === 'green' ? 'border-[#12a150] text-[#12a150]' : 'border-[#7c3aed] text-[#7c3aed]')}>
        <Check className="h-9 w-9" />
      </div>
    </div>
  );
}

/** Нижняя навигация макета: Смена / Журнал / Ещё. */
export function BottomTabs({ active, onSelect }: {
  active: 'shift' | 'journal' | 'more';
  onSelect: (tab: 'shift' | 'journal' | 'more') => void;
}) {
  const tabs = [
    { id: 'shift' as const, label: 'Смена' },
    { id: 'journal' as const, label: 'Журнал' },
    { id: 'more' as const, label: 'Ещё' },
  ];
  return (
    <nav className="-m-3 flex border-t border-border bg-card">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => onSelect(tab.id)}
          className={cn('flex-1 py-2.5 text-xs font-medium',
            active === tab.id ? 'text-[#1e5bd6]' : 'text-muted-foreground')}>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
