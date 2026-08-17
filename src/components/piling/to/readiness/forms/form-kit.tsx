'use client';

import type React from 'react';
import { useId, useMemo, useState } from 'react';
import { ArrowLeft, Check, Plus, X } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { card } from '../settings/shared-ui';

/*
  Общие части экранов создания — основа стиля из макета владельца (16.08.2026).

  Собраны отдельно от формы наряда намеренно: тот же макет описывает «Создание
  заявки» и «Создание смены», и они обязаны выглядеть одинаково не потому, что
  кто-то аккуратно повторил отступы, а потому что собраны из одних деталей.
*/

/** Шапка экрана создания: «Назад», заголовок, подзаголовок. */
export function FormPage({
  title, subtitle, onBack, children, footer,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Назад
        </button>
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-2 pb-2">{children}</div>
      {/*
        Панель действий прилипает к низу: форма длинная, и на ноутбуке кнопка
        «Создать наряд» иначе оказывается за краем экрана — человек заполняет
        всё и не понимает, чем это завершить.
      */}
      <div className="sticky bottom-0 z-10 mt-2 flex flex-wrap justify-end gap-2 border-t border-border bg-card/95 px-3 py-3 backdrop-blur">
        {footer}
      </div>
    </div>
  );
}

/** Карточка-раздел формы. */
export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cn(card, 'p-3 sm:p-4')}>
      <h3 className="text-sm font-bold text-foreground">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** Подпись поля со звёздочкой обязательности и пояснением снизу. */
export function Field({
  label, required, hint, htmlFor, children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-2xs font-semibold text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive-strong" aria-hidden>*</span>}
        {required && <span className="sr-only"> (обязательное поле)</span>}
      </label>
      {children}
      {hint && <span className="text-3xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export interface TileOption {
  id: string;
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}

/** Плиточный выбор одного значения: тип работ, тип заявки, тип смены. */
export function TileSelect({
  options, value, onChange, ariaLabel,
}: {
  options: TileOption[];
  value: string | null;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              'flex min-h-[62px] items-center gap-2.5 rounded-lg border p-3 text-left transition-colors',
              selected
                ? 'border-signal bg-signal/10 ring-1 ring-inset ring-signal/30'
                : 'border-border hover:bg-muted',
            )}
          >
            <span className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
              selected ? 'bg-signal/20 text-signal-strong' : 'bg-muted text-muted-foreground',
            )}>
              {option.icon}
            </span>
            <span className="min-w-0">
              <span className={cn('block truncate text-xs font-bold', selected && 'text-signal-strong')}>
                {option.title}
              </span>
              {option.hint && <span className="block truncate text-3xs text-muted-foreground">{option.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Поле со счётчиком символов.
 *
 * Счётчик не украшение: предел он и показывает, и соблюдает. Красным он
 * становится ДО отказа, а не после — человек видит границу, пока печатает,
 * а не когда сервер отверг форму целиком.
 */
export function CountedField({
  value, onChange, limit, placeholder, multiline, id,
}: {
  value: string;
  onChange: (value: string) => void;
  limit: number;
  placeholder?: string;
  multiline?: boolean;
  id?: string;
}) {
  const over = value.length > limit;
  const shared = 'w-full rounded-md border bg-background p-2.5 text-xs text-foreground placeholder:text-muted-foreground';
  return (
    <div className="grid gap-1">
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={cn(shared, 'min-h-20 resize-y', over ? 'border-destructive' : 'border-input')}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={cn(shared, 'min-h-11', over ? 'border-destructive' : 'border-input')}
        />
      )}
      <span className={cn('text-right text-3xs', over ? 'font-semibold text-destructive-strong' : 'text-muted-foreground')}>
        {value.length}/{limit}
      </span>
    </div>
  );
}

/**
 * Чипсы с удалением и добавлением — опасные факторы, состав бригады.
 *
 * `suggestions` показываются под полем: типовые формулировки вида работ.
 * `onSaveSuggestion` появляется только для того, чего в подсказках ещё нет, —
 * так шаблон пополняется тем, что человек правда пишет, а не наугад.
 */
export function ChipList({
  values, onChange, suggestions = [], onSaveSuggestion, placeholder, ariaLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  onSaveSuggestion?: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const lower = useMemo(
    () => new Set(values.map((item) => item.toLocaleLowerCase('ru'))),
    [values],
  );
  const add = (raw: string) => {
    const next = raw.trim().replace(/\s+/g, ' ');
    if (!next || lower.has(next.toLocaleLowerCase('ru'))) { setDraft(''); return; }
    onChange([...values, next]);
    setDraft('');
  };
  const unused = suggestions.filter((item) => !lower.has(item.toLocaleLowerCase('ru')));
  return (
    <div className="grid gap-2">
      <ul aria-label={ariaLabel} className="flex flex-wrap items-center gap-1.5">
        {values.map((item) => (
          <li key={item}>
            <span className="flex items-center gap-1 rounded border border-signal/30 bg-signal/10 py-1 pl-2 pr-1 text-3xs font-semibold text-signal-strong">
              {item}
              <button
                type="button"
                onClick={() => onChange(values.filter((entry) => entry !== item))}
                aria-label={`Убрать: ${item}`}
                className="grid h-5 w-5 place-items-center rounded hover:bg-signal/20"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          </li>
        ))}
        {values.length === 0 && (
          <li className="text-3xs text-muted-foreground">Пока ничего не указано.</li>
        )}
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Input
          id={inputId}
          aria-label={`Добавить: ${ariaLabel}`}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter в поле внутри формы иначе отправил бы форму целиком.
            event.preventDefault();
            add(draft);
          }}
          className="min-h-11 min-w-[180px] flex-1 text-xs"
        />
        <Button type="button" variant="outline" className="min-h-11 text-2xs" onClick={() => add(draft)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          Добавить
        </Button>
        {onSaveSuggestion && draft.trim() && !suggestions.some(
          (item) => item.toLocaleLowerCase('ru') === draft.trim().toLocaleLowerCase('ru'),
        ) && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 text-2xs"
            onClick={() => { onSaveSuggestion(draft.trim()); add(draft); }}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
            Добавить и запомнить
          </Button>
        )}
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-3xs text-muted-foreground">Типовые:</span>
          {unused.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => add(item)}
              className="rounded border border-dashed border-border px-2 py-1 text-3xs text-muted-foreground hover:border-signal hover:text-signal-strong"
            >
              + {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Инициалы для кружка: «Смирнов А.В.» → «СА». Фото людей в системе нет. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/[\s.]+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toLocaleUpperCase('ru');
}

export function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-full text-3xs font-bold',
        muted ? 'bg-muted text-muted-foreground' : 'bg-info/15 text-info-strong',
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

export interface PersonOption { id: string; name: string; role: string }

/**
 * Ответственное лицо: выбор из учётных записей ИЛИ свободное ФИО.
 *
 * Гибрид — требование владельца: у наблюдающего учётки может не быть вовсе,
 * и запрет вписать фамилию руками означал бы, что наряд не оформить.
 * Выбранная учётка не хранит имя из браузера: сервер подставит своё.
 */
export function PersonField({
  people, userId, name, onChange, label, required, id,
}: {
  people: PersonOption[];
  userId: string | null;
  name: string;
  onChange: (next: { userId: string | null; name: string }) => void;
  label: string;
  required?: boolean;
  id: string;
}) {
  const selected = userId ? people.find((person) => person.id === userId) ?? null : null;
  const free = userId === null && name.length > 0;
  return (
    <Field label={label} required={required} htmlFor={id}>
      <div className="flex items-center gap-2 rounded-md border border-input bg-background p-1.5">
        <Avatar name={selected?.name ?? name ?? ''} muted={!selected && !free} />
        <div className="min-w-0 flex-1">
          <select
            id={id}
            value={userId ?? (free ? '__free__' : '')}
            onChange={(event) => {
              const next = event.target.value;
              if (next === '') { onChange({ userId: null, name: '' }); return; }
              if (next === '__free__') { onChange({ userId: null, name: name || ' ' }); return; }
              const person = people.find((entry) => entry.id === next);
              onChange({ userId: next, name: person?.name ?? '' });
            }}
            className="w-full bg-transparent text-xs font-semibold text-foreground outline-none"
          >
            <option value="">Не назначен</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.name} — {person.role}</option>
            ))}
            <option value="__free__">Вписать ФИО вручную…</option>
          </select>
          {selected && <span className="block truncate text-3xs text-muted-foreground">{selected.role}</span>}
        </div>
      </div>
      {free && (
        <Input
          aria-label={`${label}: ФИО`}
          value={name.trim()}
          placeholder="Фамилия И.О."
          onChange={(event) => onChange({ userId: null, name: event.target.value })}
          className="mt-1 min-h-11 text-xs"
        />
      )}
    </Field>
  );
}

/**
 * Поле со свободным вводом и подсказками.
 *
 * Место работы и объект вписываются руками — так решил владелец: они меняются,
 * и заранее их никто не перечислит. Подсказки лишь избавляют от повторного
 * набора: объекты организации и личные шаблоны пользователя. В наряд уходит
 * ТЕКСТ, а не ссылка, — документ не должен поехать, если место переименуют.
 */
export function SuggestField({
  value, onChange, suggestions, placeholder, id, onSave, savable,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  id: string;
  onSave?: () => void;
  savable?: boolean;
}) {
  const listId = `${id}-suggestions`;
  return (
    <div className="grid gap-1">
      <Input
        id={id}
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 text-xs"
      />
      <datalist id={listId}>
        {suggestions.map((item) => <option key={item} value={item} />)}
      </datalist>
      {onSave && savable && (
        <button
          type="button"
          onClick={onSave}
          className="justify-self-start text-3xs font-semibold text-info-strong underline-offset-2 hover:underline"
        >
          Сохранить, чтобы не вписывать заново
        </button>
      )}
    </div>
  );
}
