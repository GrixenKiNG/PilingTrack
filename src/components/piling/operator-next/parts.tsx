'use client';

import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';

/**
 * Крупные части экрана машиниста «следующего поколения».
 *
 * Цели нажатия и высоты заданы здесь один раз, чтобы правило «кнопка действия
 * не ниже 56 точек, зона нажатия не меньше 48» не зависело от дисциплины
 * каждого экрана: экран держат в перчатке на морозе, и промах по кнопке
 * высотой 36 точек стоит смены.
 */

/** Заголовок группы внутри экрана. Один уровень, без вложенности. */
export function StageTitle({children, hint}: {children: ReactNode; hint?: ReactNode}) {
  return (
    <div className="pt-1">
      <h2 className="text-base font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {hint ? <p className="mt-1 text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Причина, по которой действие недоступно, и что сделать дальше.
 *
 * Правило 7: у каждой недоступной кнопки видна причина и следующий шаг. Пока
 * кнопка просто гасла, машинист не знал, чего не хватает — марки, количества
 * или чек-листа ТБ (находка №5 аудита).
 */
export function ReasonNote({children}: {children: ReactNode}) {
  return (
    <p role="note" className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm font-medium text-warning-strong">
      {children}
    </p>
  );
}

/**
 * Кнопка действия.
 *
 * `reason` показывается ТОЛЬКО когда кнопка заблокирована: у доступной кнопки
 * причина не нужна, а лишний текст отодвигает действие. Если `onClick` нет —
 * кнопка недоступна, и причина обязательна: действие без обработчика и без
 * объяснения — это тупик.
 */
export function ActionButton({
  label, hint, onClick, disabled = false, reason, tone = 'primary', type = 'button',
}: {
  label: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  reason?: ReactNode;
  tone?: 'primary' | 'ghost' | 'danger' | 'neutral';
  type?: 'button' | 'submit';
}) {
  const blocked = disabled || !onClick;
  return (
    <div className="space-y-1.5">
      <button
        type={type}
        onClick={onClick}
        disabled={blocked}
        className={cn(
          'onx-action flex w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-4 text-base font-bold shadow-sm transition-all active:translate-y-px',
          'disabled:cursor-not-allowed disabled:opacity-55',
          tone === 'primary' && 'border-signal bg-signal text-white hover:bg-signal-strong',
          tone === 'danger' && 'border-destructive bg-destructive text-white',
          tone === 'ghost' && 'border-border bg-card text-foreground',
          tone === 'neutral' && 'border-border bg-secondary text-foreground',
        )}
      >
        <span>{label}</span>
        {hint ? <span className="text-sm font-medium opacity-80">{hint}</span> : null}
      </button>
      {blocked && reason ? <ReasonNote>{reason}</ReasonNote> : null}
    </div>
  );
}

/** Крупная кнопка-выбор: марка сваи, тип бурения, причина простоя, тип смены. */
export function ChoiceButton({
  label, hint, selected, onClick, disabled = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'onx-choice flex w-full flex-col items-start justify-center gap-0.5 rounded-xl border px-4 py-2 text-left shadow-xs transition-colors',
        selected ? 'border-signal bg-signal/10' : 'border-border bg-card hover:bg-secondary',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span className="text-base font-bold leading-tight">{label}</span>
      {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

/**
 * Карточка «Следующее действие».
 *
 * Взята из v10: новичку нужен ответ «что нажать сейчас», а не сводка из десяти
 * плиток, которую надо читать целиком и самому решать, что важнее.
 */
export function NextActionCard({
  title, hint, actionLabel, onAction, disabled = false, reason, tone = 'primary', testId,
}: {
  title: string;
  hint: ReactNode;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  reason?: ReactNode;
  tone?: 'primary' | 'ghost' | 'danger' | 'neutral';
  testId?: string;
}) {
  return (
    <section
      data-testid={testId ?? 'next-action'}
      className="rounded-xl border border-signal/40 bg-signal/5 p-4 shadow-xs"
    >
      <h2 className="text-base font-semibold uppercase tracking-wider text-signal-strong">Следующее действие</h2>
      <p className="mt-1 text-base font-bold leading-snug">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      <div className="mt-3">
        <ActionButton label={actionLabel} onClick={onAction} disabled={disabled} reason={reason} tone={tone} />
      </div>
    </section>
  );
}

/**
 * Полоса ошибки ПОВЕРХ рабочего экрана.
 *
 * ПОЧЕМУ НЕ ПОЛНОЭКРАННАЯ ОШИБКА. Полноэкранная ошибка размонтирует рабочий
 * экран вместе с открытой формой: сбой обновления стирал бы набранное, хотя
 * человек его не отправлял и ни в чём не виноват. Полноэкранная ошибка остаётся
 * только для первой загрузки, когда показывать ещё нечего.
 */
export function ErrorStrip({
  message, onRetry, retryLabel = 'Обновить', testId,
}: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId ?? 'error-strip'}
      className="mx-3 mt-2 space-y-2 rounded-xl border border-destructive/45 bg-destructive/8 p-3"
    >
      <p className="text-base font-semibold text-destructive-strong">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="onx-action w-full rounded-lg border border-destructive bg-card px-3 text-sm font-bold text-destructive-strong"
      >
        {retryLabel}
      </button>
    </div>
  );
}

/**
 * Полоса подтверждения: запись принята.
 *
 * Нужна там, где раньше обрыв следующего чтения показывал «Нет связи» уже
 * после того, как сервер запись принял: человек вводил то же второй раз.
 */
export function NoticeStrip({children, testId}: {children: ReactNode; testId?: string}) {
  return (
    <div
      role="status"
      data-testid={testId ?? 'notice-strip'}
      className="mx-3 mt-2 rounded-xl border border-success/45 bg-success/8 px-3 py-2 text-sm font-semibold text-success-strong"
    >
      {children}
    </div>
  );
}

/**
 * Значок состояния: цвет читают не все, знак — все.
 * Локальная копия нужна потому, что общий `Sign` рисует круг под 20 точек —
 * для поля этого мало.
 */
export function StatusMark({tone, children}: {tone: 'ok' | 'warning' | 'danger' | 'idle'; children: ReactNode}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold',
        tone === 'ok' && 'bg-success text-white',
        tone === 'warning' && 'bg-warning text-warning-foreground',
        tone === 'danger' && 'bg-destructive text-white',
        tone === 'idle' && 'bg-secondary text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}
