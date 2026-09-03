'use client';

/**
 * Формы, которые открываются поверх экрана смены: свая, простой, сдача.
 *
 * Все три раньше были переходами на `/report` — то есть модуль отдавал работу
 * старому экрану и переставал быть самостоятельным. Здесь они живут поверх
 * шага: человек не теряет место в смене и возвращается туда же.
 */

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { StepButton } from './ui';
import type { DowntimeReason, PileGrade } from './use-shift-report';

/** Панель поверх экрана: шапка, содержимое, кнопка внизу. */
function Sheet({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-2 bg-[#1e5bd6] px-3 py-3 text-white">
        <button type="button" onClick={onClose}
          className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/15">
          ✕<span className="sr-only">Закрыть</span>
        </button>
        <p className="text-base font-semibold">{title}</p>
      </header>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
      <div className="border-t border-border bg-card p-3">{footer}</div>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const control = 'h-11 w-full rounded-lg border border-border bg-card px-3 text-sm';

/** Добавить сваи: марка и количество. */
export function PileSheet({ open, grades, busy, onClose, onAdd }: {
  open: boolean;
  grades: PileGrade[];
  busy: boolean;
  onClose: () => void;
  onAdd: (gradeId: string, count: number) => void;
}) {
  const [gradeId, setGradeId] = useState('');
  const [count, setCount] = useState(1);
  if (!open) return null;
  const grade = grades.find((item) => item.id === gradeId) ?? null;

  return (
    <Sheet
      title="Новая свая"
      onClose={onClose}
      footer={
        <StepButton
          label={count > 1 ? `Добавить ${count} шт` : 'Добавить'}
          onClick={() => onAdd(gradeId, count)}
          disabled={!gradeId}
          busy={busy}
        />
      }
    >
      <Field label="Марка сваи" htmlFor="pile-grade">
        {grades.length === 0 ? (
          // Пустой список — не поломка формы: на объекте нет плана свай, и
          // принять их сервер всё равно не даст. Говорим это словами, а не
          // пустым выпадающим списком.
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
            На объекте не запланировано ни одной марки свай — обратитесь к диспетчеру
          </p>
        ) : (
          <select id="pile-grade" value={gradeId}
            onChange={(event) => setGradeId(event.target.value)} className={control}>
            <option value="">Выберите марку</option>
            {grades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        {/* Длина берётся из справочника, а не из названия: разбор «м.п.» из
            имени марки уже расходился в семи местах и его свели к этому полю. */}
        {grade?.lengthMm != null && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Длина по справочнику: {(grade.lengthMm / 1000).toFixed(1)} м
          </p>
        )}
      </Field>

      <Field label="Количество">
        <div className="flex items-stretch gap-2">
          <button type="button" onClick={() => setCount((value) => Math.max(1, value - 1))}
            className="h-14 w-16 rounded-lg border border-border bg-card text-2xl font-semibold">−</button>
          <input
            inputMode="numeric"
            aria-label="Количество свай"
            value={count}
            onChange={(event) => setCount(Math.max(1, Number(event.target.value.replace(/\D/g, '')) || 1))}
            className="h-14 flex-1 rounded-lg border border-border bg-card text-center text-2xl font-bold tabular-nums"
          />
          <button type="button" onClick={() => setCount((value) => value + 1)}
            className="h-14 w-16 rounded-lg border border-border bg-card text-2xl font-semibold">+</button>
        </div>
      </Field>
    </Sheet>
  );
}

/** Зафиксировать простой: причина и продолжительность в часах. */
export function DowntimeSheet({ open, reasons, busy, onClose, onAdd }: {
  open: boolean;
  reasons: DowntimeReason[];
  busy: boolean;
  onClose: () => void;
  onAdd: (reasonId: string, hours: number, comment: string) => void;
}) {
  const [reasonId, setReasonId] = useState('');
  const [hours, setHours] = useState(0.5);
  const [comment, setComment] = useState('');
  if (!open) return null;

  const label = hours >= 1
    ? `${Math.floor(hours)} ч${hours % 1 ? ' 30 мин' : ''}`
    : '30 мин';

  return (
    <Sheet
      title="Простой"
      onClose={onClose}
      footer={
        <StepButton
          label="Записать простой"
          onClick={() => onAdd(reasonId, hours, comment.trim())}
          disabled={!reasonId}
          busy={busy}
        />
      }
    >
      <Field label="Причина" htmlFor="downtime-reason">
        <select id="downtime-reason" value={reasonId}
          onChange={(event) => setReasonId(event.target.value)} className={control}>
          <option value="">Выберите причину</option>
          {reasons.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>

      <Field label="Сколько простояли">
        <div className="flex items-stretch gap-2">
          {/* Шаг полчаса: простой в минутах оператор всё равно округляет, а
              часы — та единица, в которой его сверяет сервер. */}
          <button type="button" onClick={() => setHours((value) => Math.max(0.5, value - 0.5))}
            className="h-14 w-16 rounded-lg border border-border bg-card text-2xl font-semibold">−</button>
          <div className="flex h-14 flex-1 items-center justify-center rounded-lg border border-border bg-card text-xl font-bold tabular-nums">
            {label}
          </div>
          <button type="button" onClick={() => setHours((value) => Math.min(24, value + 0.5))}
            className="h-14 w-16 rounded-lg border border-border bg-card text-2xl font-semibold">+</button>
        </div>
      </Field>

      <Field label="Комментарий" htmlFor="downtime-comment">
        <textarea id="downtime-comment" rows={3} value={comment} maxLength={1000}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Что именно случилось"
          className="w-full rounded-lg border border-border bg-card p-3 text-sm" />
      </Field>
    </Sheet>
  );
}

/** Сдача смены: состояние машины словами следующему оператору. */
export function HandoverSheet({ open, equipmentName, busy, onClose, onSubmit }: {
  open: boolean;
  equipmentName: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (summary: string) => void;
}) {
  const [summary, setSummary] = useState('');
  if (!open) return null;
  const tooShort = summary.trim().length < 3;

  return (
    <Sheet
      title="Сдать смену"
      onClose={onClose}
      footer={
        <StepButton label="Передать смену" onClick={() => onSubmit(summary.trim())}
          disabled={tooShort} busy={busy} />
      }
    >
      <p className="text-sm text-muted-foreground">
        {equipmentName ?? 'Установка'} — что важно знать следующей смене
      </p>
      <textarea
        rows={6}
        value={summary}
        maxLength={4000}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="Состояние машины, незавершённые работы, на что обратить внимание"
        className="w-full rounded-lg border border-border bg-card p-3 text-sm"
      />
      {/* Пустая передача — это «всё нормально», сказанное молчанием. Следующий
          оператор из неё ничего не узнаёт, поэтому три знака минимум требует и
          сервер, и эта форма. */}
      <p className={cn('text-xs', tooShort ? 'text-muted-foreground' : 'text-[#12a150]')}>
        {tooShort ? 'Опишите состояние машины — хотя бы коротко' : 'Готово к передаче'}
      </p>
    </Sheet>
  );
}
