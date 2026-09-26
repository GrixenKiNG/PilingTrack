'use client';

/** Рабочие экраны v2 в общей светлой теме PilingTrack. */

import type { ReactNode } from 'react';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { Check, ChevronLeft } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import { OfflineQueueBanner } from '@/components/piling/operator-mobile/offline-queue-banner';
import { useOfflineQueue } from '@/components/piling/operator-mobile/use-offline-queue';

/** Имена фаз сохранены для совместимости; оформление использует токены продукта. */
export type StepTone = 'blue' | 'green' | 'purple';

const TONE_BAR: Record<StepTone, string> = {
  blue: 'border-b-signal',
  green: 'border-b-success',
  purple: 'border-b-signal',
};

const TONE_BUTTON: Record<StepTone, string> = {
  blue: 'bg-signal hover:bg-signal-strong',
  green: 'bg-signal hover:bg-signal-strong',
  purple: 'bg-signal hover:bg-signal-strong',
};

/** Экран шага: светлая шапка с акцентом фазы, содержимое и основное действие. */
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
  // Очередь устройства видна на каждом шаге смены: раньше v2 клал записи в
  // очередь, но не показывал и не отправлял её — они ждали, пока человек не
  // откроет другой экран.
  const queue = useOfflineQueue();
  return (
    // Высота НЕ прибита к 100dvh. Оболочка приложения рисует свою шапку над
    // модулем, поэтому экран на её высоту выше окна: кнопка внизу уезжала за
    // край, и нажать её было нельзя. Здесь высота по содержимому, а кнопка
    // прилипает к нижней границе окна — она достижима и на длинном списке
    // осмотра, и на коротком экране пуска.
    <div className="mx-auto w-full max-w-[560px] bg-background">
      <header className={cn('flex items-center gap-2 border-b-2 bg-card px-3 py-3 text-foreground', TONE_BAR[tone])}>
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Назад"
            className="-ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-signal-strong hover:bg-secondary">
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : <span className="w-7" />}
        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold leading-tight">{title}</p>
          {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </header>

      <OfflineQueueBanner items={queue.queued} onRetry={queue.retry} onDiscard={queue.discard} className="space-y-1 px-4 pt-3" />
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
        <span className="block truncate text-base text-foreground">{label}</span>
        {hint && <span className="block truncate text-sm text-muted-foreground">{hint}</span>}
      </span>
      {right ?? (
        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-success bg-success text-white' : 'border-border')}>
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
      <span className={cn('text-base font-semibold',
        tone === 'ok' ? 'text-success-strong'
          : tone === 'warn' ? 'text-warning-strong' : 'text-foreground')}>{value}</span>
    </div>
  );
}

/** Большой круг с галочкой — экраны пуска и закрытия смены. */
export function BigCheck({ tone }: { tone: 'green' | 'purple' }) {
  return (
    <div className={cn('mx-auto flex h-24 w-24 items-center justify-center rounded-full',
      tone === 'green' ? 'bg-success/12' : 'bg-success/12')}>
      <div className={cn('flex h-16 w-16 items-center justify-center rounded-full border-[3px]',
        tone === 'green' ? 'border-success text-success-strong' : 'border-success text-success-strong')}>
        <Check className="h-9 w-9" />
      </div>
    </div>
  );
}

export type V2Tab = 'shift' | 'safety' | 'equipment' | 'more';

/**
 * Нижняя навигация: Смена / ТБ / Техника / Ещё — один набор во всех модулях
 * оператора.
 *
 * «ТБ» стоит вторым, а не в «Ещё»: допуск и инструктажи человек открывает не в
 * конце смены, а до неё, и искать их в списке «прочего» он не станет. Журнал
 * смены, наоборот, открывают раз в день — он уехал в «Ещё».
 */
export function BottomTabs({ active, onSelect }: {
  active: V2Tab;
  onSelect: (tab: V2Tab) => void;
}) {
  const tabs: {id: V2Tab; label: string; icon: PilingIconName}[] = [
    { id: 'shift', label: 'Смена', icon: 'home' },
    { id: 'safety', label: 'ТБ', icon: 'accepted' },
    { id: 'equipment', label: 'Техника', icon: 'equipment-rig' },
    { id: 'more', label: 'Ещё', icon: 'menu' },
  ];
  return (
    <nav aria-label="Разделы смены" className="-m-3 flex border-t border-border bg-card">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => onSelect(tab.id)} aria-current={active === tab.id ? 'page' : undefined}
          className={cn('flex min-h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-signal',
            active === tab.id ? 'bg-signal/5 text-signal-strong shadow-[inset_0_-3px_var(--signal)]' : 'text-muted-foreground')}>
          <PilingIcon name={tab.icon} size={24} decorative />
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
