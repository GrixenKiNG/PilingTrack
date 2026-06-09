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
        value === v ? activeClass : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        'disabled:opacity-50'
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {btn('YES', 'Да', 'border-emerald-500 bg-emerald-50 text-emerald-700')}
      {btn('NO', 'Нет', 'border-rose-500 bg-rose-50 text-rose-700')}
    </div>
  );
}

export function Status4Control({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
  const options = [
    { v: 'OK', label: 'Исправно', cls: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
    { v: 'REMARK', label: 'Замечание', cls: 'border-amber-500 bg-amber-50 text-amber-700' },
    { v: 'FAULT', label: 'Неисправно', cls: 'border-rose-500 bg-rose-50 text-rose-700' },
    { v: 'NA', label: 'Не проверено', cls: 'border-slate-400 bg-slate-100 text-slate-600' },
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
            value === v ? cls : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
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
        className="h-4 w-4 rounded border-slate-300 accent-orange-500"
      />
      <span className="text-sm text-slate-700">{checked ? 'Выполнено' : 'Не выполнено'}</span>
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
      {unit && <span className="text-sm text-slate-500">{unit}</span>}
      {norm && <span className="text-xs text-slate-400">норма: {norm}</span>}
    </div>
  );
}
