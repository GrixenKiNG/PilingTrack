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
import { downtimeInterval, formatIntervalMinutes, hhmm } from '../operator-mobile/downtime-interval';

/*
  Справочники приходят из снимка рабочего места — того же, что кормит все
  остальные модули оператора. Своих описаний у форм больше нет: пока они
  тянулись из `use-shift-report`, модуль вёл отдельный список марок и отдельный
  путь записи, и то и другое расходилось с остальными версиями.
*/
export interface PileGrade { id: string; name: string; lengthMm: number | null }
export interface DowntimeReason { id: string; name: string }
export interface DrillingType { id: string; name: string }

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
          // Пустой список — не поломка формы. Марки берутся из плана объекта, а
          // если плана нет — из общего справочника; пусто здесь означает, что
          // марок нет нигде, и это заводит администратор, а не оператор.
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
            Марки свай не заведены — обратитесь к диспетчеру
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

/**
 * Лидерное бурение: тип, количество скважин и метры на скважину.
 *
 * ПОЧЕМУ ЭТА ФОРМА ПОЯВИЛАСЬ. Ввода бурения в модуле не было вообще, хотя
 * комбинированная установка за смену бурит и бьёт. Смена закрывалась с нулём
 * скважин — не потому, что не бурили, а потому что записать было негде.
 *
 * Метры спрашиваем на ОДНУ скважину, а не итогом: глубину машинист знает по
 * проходке, а общий метраж считает в уме и ошибается на кратное число.
 */
export function DrillingSheet({ open, types, busy, onClose, onAdd }: {
  open: boolean;
  types: DrillingType[];
  busy: boolean;
  onClose: () => void;
  onAdd: (typeId: string, count: number, metersPerUnit: number) => void;
}) {
  const [typeId, setTypeId] = useState('');
  const [count, setCount] = useState(1);
  const [meters, setMeters] = useState('');
  if (!open) return null;

  const metersPerUnit = Number(meters.replace(',', '.'));
  const metersOk = Number.isFinite(metersPerUnit) && metersPerUnit > 0;

  return (
    <Sheet
      title="Лидерное бурение"
      onClose={onClose}
      footer={
        <StepButton
          label={metersOk ? `Записать ${(count * metersPerUnit).toFixed(1)} м` : 'Записать бурение'}
          onClick={() => onAdd(typeId, count, metersPerUnit)}
          disabled={!typeId || !metersOk}
          busy={busy}
        />
      }
    >
      <Field label="Тип бурения" htmlFor="drilling-type">
        {types.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
            Типы бурения не заведены — обратитесь к диспетчеру
          </p>
        ) : (
          <select id="drilling-type" value={typeId}
            onChange={(event) => setTypeId(event.target.value)} className={control}>
            <option value="">Выберите тип</option>
            {types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
      </Field>

      <Field label="Скважин">
        <div className="flex items-stretch gap-2">
          <button type="button" onClick={() => setCount((value) => Math.max(1, value - 1))}
            className="h-14 w-16 rounded-lg border border-border bg-card text-2xl font-semibold">−</button>
          <input
            inputMode="numeric"
            aria-label="Количество скважин"
            value={count}
            onChange={(event) => setCount(Math.max(1, Number(event.target.value.replace(/\D/g, '')) || 1))}
            className="h-14 flex-1 rounded-lg border border-border bg-card text-center text-2xl font-bold tabular-nums"
          />
          <button type="button" onClick={() => setCount((value) => value + 1)}
            className="h-14 w-16 rounded-lg border border-border bg-card text-2xl font-semibold">+</button>
        </div>
      </Field>

      <Field label="Глубина одной скважины, м" htmlFor="drilling-meters">
        <input
          id="drilling-meters"
          inputMode="decimal"
          value={meters}
          onChange={(event) => setMeters(event.target.value)}
          placeholder="Например, 9,5"
          className="h-14 w-full rounded-lg border border-border bg-card px-3 text-center text-2xl font-bold tabular-nums"
        />
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
  onAdd: (reasonId: string, startedAt: string, endedAt: string, comment: string) => void;
}) {
  const [reasonId, setReasonId] = useState('');
  const [startedHm, setStartedHm] = useState('');
  const [endedHm, setEndedHm] = useState('');
  const [comment, setComment] = useState('');

  // Хук обязан вызываться до любого раннего возврата, поэтому интервал
  // считается здесь, а не после проверки `open`.
  const interval = downtimeInterval(startedHm, endedHm);
  if (!open) return null;

  return (
    <Sheet
      title="Простой"
      onClose={onClose}
      footer={
        <StepButton
          label="Записать простой"
          onClick={() => interval && onAdd(reasonId, interval.startedAt, interval.endedAt, comment.trim())}
          disabled={!reasonId || !interval}
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

      {/* Начало и конец вместо шага в полчаса: шаг округлял двадцать минут до
          получаса, а получас — до часа на сервере, и в отчёт уходило втрое
          больше простоя, чем было. */}
      <Field label="Простой начался" htmlFor="downtime-start">
        <input id="downtime-start" type="time" value={startedHm}
          onChange={(event) => setStartedHm(event.target.value)}
          className={`${control} tabular-nums`} />
      </Field>

      <Field label="Закончился" htmlFor="downtime-end">
        <div className="flex items-stretch gap-2">
          <input id="downtime-end" type="time" value={endedHm}
            onChange={(event) => setEndedHm(event.target.value)}
            className={`${control} tabular-nums`} />
          <button type="button" onClick={() => setEndedHm(hhmm(new Date()))}
            className="h-14 shrink-0 rounded-lg border border-border bg-card px-4 text-sm font-semibold">
            Сейчас
          </button>
        </div>
      </Field>

      {interval ? (
        <p className="rounded-lg bg-info/10 px-3 py-2 text-sm font-semibold text-info-strong">
          Простой: {formatIntervalMinutes(interval.minutes)}
        </p>
      ) : null}

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
