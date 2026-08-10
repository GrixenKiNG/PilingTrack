'use client';

/**
 * Контролы ответа для пунктов осмотра/ТО (используются в RunInspection).
 * Вынесены из run-inspection.tsx, чтобы держать основной файл < 500 строк.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function YesNoControl({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const btn = (v: string, label: string, activeClass: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(value === v ? '' : v)}
      className={cn(
        'flex-1 rounded-md border py-1.5 text-sm font-medium transition-colors',
        value === v ? activeClass : 'border-border bg-card text-muted-foreground hover:bg-muted',
        'disabled:opacity-50'
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {btn('YES', 'Да', 'border-success bg-success/10 text-success-strong')}
      {btn('NO', 'Нет', 'border-destructive bg-destructive/10 text-destructive-strong')}
    </div>
  );
}

export function Status4Control({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const options = [
    { v: 'OK', label: 'Исправно', cls: 'border-success bg-success/10 text-success-strong' },
    { v: 'REMARK', label: 'Замечание', cls: 'border-warning bg-warning/10 text-warning-strong' },
    { v: 'FAULT', label: 'Неисправно', cls: 'border-destructive bg-destructive/10 text-destructive-strong' },
    { v: 'NA', label: 'Не проверено', cls: 'border-slate-400 bg-muted text-muted-foreground' },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {options.map(({ v, label, cls }) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === v ? '' : v)}
          className={cn(
            'rounded-md border py-1.5 text-xs font-medium transition-colors',
            value === v ? cls : 'border-border bg-card text-muted-foreground hover:bg-muted',
            'disabled:opacity-50'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function DoneControl({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const checked = value === 'DONE';
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked ? 'DONE' : 'NOT_DONE')}
        className="h-4 w-4 rounded border-border accent-signal"
      />
      <span className="text-sm text-foreground">{checked ? 'Выполнено' : 'Не выполнено'}</span>
    </label>
  );
}

export function MeasureControl({
  value, onChange, unit, norm, disabled,
}: {
  value: string; onChange: (v: string) => void; unit: string | null; norm: string | null; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Значение"
        className="w-28"
      />
      {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      {norm && <span className="text-xs text-muted-foreground">норма: {norm}</span>}
    </div>
  );
}
