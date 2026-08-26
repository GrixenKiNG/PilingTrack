'use client';

/**
 * Оболочка страницы создания — общая для «Создать заявку» и «Создать смену».
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА, А НЕ ДИАЛОГ. Обе кнопки раньше обманывали:
 * «Создать заявку» была ссылкой на доску нарядов (переход есть, формы нет), а
 * «Создать смену» молча заводила смену со значениями по умолчанию — без выбора
 * установки, даты и времени. С точки зрения человека не происходило ничего.
 * Форма на своей странице показывает, что именно он создаёт, и до нажатия
 * «Создать» ничего не сохраняется.
 *
 * Здесь только раскладка. Поля и отправку держит вызывающий: у заявки и смены
 * общего в этом нет ничего, кроме внешнего вида.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CreationFormProps {
  title: string;
  subtitle: string;
  /** Куда возвращает «Назад» и «Отмена» — туда, откуда пришли. */
  backHref: string;
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
  children: ReactNode;
}

export function CreationForm({
  title, subtitle, backHref, submitLabel, onSubmit, busy = false, children,
}: CreationFormProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 sm:px-6">
      <header className="mb-5 flex items-start gap-3">
        <Button asChild variant="outline" size="sm" className="mt-0.5 h-9 shrink-0">
          <Link href={backHref}><ArrowLeft className="mr-1.5 h-4 w-4" />Назад</Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-foreground">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </header>

      <form
        className="space-y-4"
        onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
      >
        {children}

        {/*
          «Сохранить черновик» из макета здесь нет намеренно: ни у заявки, ни у
          смены нет состояния черновика. Кнопка, которая никуда не сохраняет, —
          это ровно тот обман, из-за которого и появилась эта страница.
        */}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
          <Button asChild variant="outline" className="min-h-11">
            <Link href={backHref}>Отмена</Link>
          </Button>
          <Button
            type="submit"
            disabled={busy}
            className="min-h-11 bg-signal text-white hover:bg-signal-strong"
          >
            {busy ? 'Сохраняем…' : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Блок формы: заголовок и поля в карточке — как секции в макете. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-3.5 text-sm font-bold text-foreground">{title}</h2>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

/** Подпись над полем. Звёздочка — обязательное, как в макете. */
export function FormLabel({ htmlFor, children, required = false }: {
  htmlFor?: string; children: ReactNode; required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
      {children}{required && <span className="ml-0.5 text-destructive-strong">*</span>}
    </label>
  );
}

export interface TileOption<T extends string> {
  value: T;
  label: string;
  hint: string;
  /** Акцент выбранной плитки. По умолчанию — фирменный оранжевый. */
  tone?: 'signal' | 'danger' | 'warning';
}

/**
 * Плиточный выбор из макета вместо выпадающего списка.
 *
 * Применяется там, где вариантов мало и они задают смысл записи (тип заявки,
 * тип смены, приоритет): в списке их надо сначала открыть, а здесь видно
 * сразу, и подпись под названием объясняет разницу.
 */
export function TilePicker<T extends string>({
  name, value, options, onChange, columns = 2,
}: {
  name: string;
  value: T;
  options: TileOption<T>[];
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={cn('grid gap-2.5', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}
    >
      {options.map((option) => {
        const active = option.value === value;
        const tone = option.tone ?? 'signal';
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'min-h-16 rounded-lg border px-3 py-2.5 text-left transition',
              active
                ? tone === 'danger'
                  ? 'border-destructive/50 bg-destructive/10'
                  : tone === 'warning'
                    ? 'border-warning/50 bg-warning/10'
                    : 'border-signal/50 bg-signal/10'
                : 'border-border bg-card hover:border-signal/30',
            )}
          >
            <span className={cn('block text-sm font-semibold',
              active && tone === 'danger' ? 'text-destructive-strong'
                : active && tone === 'warning' ? 'text-warning-strong'
                  : active ? 'text-signal-strong' : 'text-foreground')}>
              {option.label}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Счётчик символов под полем — как «0/100» в макете.
 *
 * Показывает предел до того, как человек в него упрётся: обрезанный на
 * середине текст объясняет неисправность хуже, чем не начатый.
 */
export function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <p className={cn('mt-1 text-right text-2xs',
      value.length > max ? 'text-destructive-strong' : 'text-muted-foreground')}>
      {value.length}/{max}
    </p>
  );
}
