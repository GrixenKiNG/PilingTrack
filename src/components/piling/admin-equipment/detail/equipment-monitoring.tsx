'use client';

/**
 * EquipmentMonitoring — machine state + telemetry for one rig.
 *
 * One unified view (no mode toggle): pick a period, each parameter card shows
 * the current (latest) value + a mini trend sparkline + min/max over the
 * window. Machine state is READ-ONLY — derived from the latest `machine_state`
 * signal (no manual override; "Нет данных" until a box reports it).
 *
 * Self-contained. No live box is connected yet, so the telemetry area normally
 * shows "ожидаем данные". PARAM_SPECS holds labels/subsystems/order and the
 * REFERENCE thresholds (provisional — calibrate per rig; see the legend).
 */

import { useCallback, useEffect, useState } from 'react';
import { Cog, Droplets, Activity } from 'lucide-react';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

type Subsystem = 'engine' | 'hydraulics' | 'other';

const SUBSYSTEMS: Array<{ key: Subsystem; title: string; icon: typeof Cog }> = [
  { key: 'engine', title: 'Двигатель', icon: Cog },
  { key: 'hydraulics', title: 'Гидравлика', icon: Droplets },
  { key: 'other', title: 'Прочее', icon: Activity },
];

type ValueKind = 'number' | 'bool' | 'count';

interface ParamSpec {
  label: string;
  subsystem: Subsystem;
  order: number;
  kind?: ValueKind;
  warn?: { min?: number; max?: number };
  alarm?: { min?: number; max?: number };
}

// Reference thresholds — provisional defaults, calibrate per equipment.
const PARAM_SPECS: Record<string, ParamSpec> = {
  engine_rpm:         { label: 'Обороты двигателя', subsystem: 'engine', order: 1, warn: { max: 2200 }, alarm: { max: 2500 } },
  fuel_rate:          { label: 'Расход топлива', subsystem: 'engine', order: 2 },
  fuel_level:         { label: 'Уровень топлива', subsystem: 'engine', order: 3, warn: { min: 15 }, alarm: { min: 5 } },
  coolant_temp:       { label: 'Темп. охл. жидкости', subsystem: 'engine', order: 4, warn: { max: 95 }, alarm: { max: 105 } },
  oil_pressure:       { label: 'Давление масла', subsystem: 'engine', order: 5, warn: { min: 1.0 }, alarm: { min: 0.5 } },
  engine_load:        { label: 'Нагрузка двигателя', subsystem: 'engine', order: 6, warn: { max: 90 }, alarm: { max: 100 } },
  battery_voltage:    { label: 'Напряжение АКБ', subsystem: 'engine', order: 7, warn: { min: 23.5, max: 29.5 }, alarm: { min: 22, max: 30.5 } },
  ecu_errors:         { label: 'Ошибки ECU', subsystem: 'engine', order: 8, kind: 'count', alarm: { max: 0 } },
  engine_hours:       { label: 'Моточасы', subsystem: 'engine', order: 9 },
  ignition:           { label: 'Зажигание', subsystem: 'engine', order: 10, kind: 'bool' },
  hydraulic_pressure: { label: 'Давление гидросистемы', subsystem: 'hydraulics', order: 1, warn: { max: 320 }, alarm: { max: 350 } },
  pump_load:          { label: 'Нагрузка насосов', subsystem: 'hydraulics', order: 2, warn: { max: 90 }, alarm: { max: 100 } },
  hydraulic_temp:     { label: 'Темп. гидравлики', subsystem: 'hydraulics', order: 3, warn: { max: 75 }, alarm: { max: 85 } },
  valve_state:        { label: 'Состояние клапанов', subsystem: 'hydraulics', order: 4 },
  hydraulic_flow:     { label: 'Расход гидрожидкости', subsystem: 'hydraulics', order: 5 },
};

const MACHINE_STATES: Record<number, { label: string; cls: string }> = {
  0: { label: 'Выключена', cls: 'bg-slate-200 text-slate-700' },
  1: { label: 'Простой', cls: 'bg-amber-100 text-amber-700' },
  2: { label: 'Движение', cls: 'bg-sky-100 text-sky-700' },
  3: { label: 'Работа', cls: 'bg-emerald-100 text-emerald-700' },
  4: { label: 'Бурение', cls: 'bg-teal-100 text-teal-700' },
  5: { label: 'Забивка свай', cls: 'bg-indigo-100 text-indigo-700' },
  6: { label: 'Извлечение', cls: 'bg-violet-100 text-violet-700' },
  7: { label: 'Ошибка', cls: 'bg-rose-100 text-rose-700' },
  8: { label: 'Обслуживание', cls: 'bg-orange-100 text-orange-700' },
};

function classifyByKeyword(type: string): Subsystem {
  const t = type.toLowerCase();
  if (/(engine|rpm|fuel|oil|coolant|двиг|моточ|volt|current|battery|electric|аккум|ток|напряж|ecu|ignition)/.test(t)) return 'engine';
  if (/(hydraul|pressure|pump|valve|гидр|давлен|насос|клапан)/.test(t)) return 'hydraulics';
  return 'other';
}

type Status = 'ok' | 'warn' | 'alarm';

function outOfRange(value: number | null, range?: { min?: number; max?: number }): boolean {
  if (value === null || !range) return false;
  if (range.min !== undefined && value < range.min) return true;
  if (range.max !== undefined && value > range.max) return true;
  return false;
}
function statusOf(value: number | null, spec?: ParamSpec): Status {
  if (!spec || value === null) return 'ok';
  if (outOfRange(value, spec.alarm)) return 'alarm';
  if (outOfRange(value, spec.warn)) return 'warn';
  return 'ok';
}
function worst(...s: Status[]): Status {
  if (s.includes('alarm')) return 'alarm';
  if (s.includes('warn')) return 'warn';
  return 'ok';
}

const STATUS_CARD: Record<Status, string> = {
  ok: '',
  warn: 'border-amber-300 bg-amber-50/40',
  alarm: 'border-rose-300 bg-rose-50',
};
const STATUS_VALUE: Record<Status, string> = {
  ok: 'text-slate-900',
  warn: 'text-amber-600',
  alarm: 'text-rose-600',
};
const SPARK_STROKE: Record<Status, string> = {
  ok: '#0d9488',
  warn: '#d97706',
  alarm: '#e11d48',
};

const orderOf = (type: string) => PARAM_SPECS[type]?.order ?? 99;
const subsystemOf = (type: string) => PARAM_SPECS[type]?.subsystem ?? classifyByKeyword(type);

interface TelemetryRecord {
  id: string;
  type: string;
  value: number;
  unit: string | null;
  timestamp: string;
}

interface ParamSeries {
  type: string;
  unit: string | null;
  values: number[];
  last: number;
  lastTs: string;
  min: number;
  max: number;
  count: number;
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  equipmentId: string;
}

export function EquipmentMonitoring({ equipmentId }: Props) {
  const [from, setFrom] = useState(shiftYmd(-6));
  const [to, setTo] = useState(todayYmd());
  const [records, setRecords] = useState<TelemetryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalid = from > to;

  const load = useCallback(async () => {
    if (from > to) return;
    setRecords(null);
    setError(null);
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999`).toISOString();
    const qs = new URLSearchParams({ equipmentId, from: fromIso, to: toIso, limit: '1000' });
    try {
      const res = await authFetch(`/api/telemetry?${qs.toString()}`);
      if (!res.ok) { setError(`Сервер вернул ${res.status}`); return; }
      const data = await res.json();
      setRecords(Array.isArray(data.records) ? data.records : []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [equipmentId, from, to]);

  useEffect(() => { void load(); }, [load]);

  // Records arrive oldest-first.
  let stateRec: TelemetryRecord | null = null;
  const seriesByType = new Map<string, ParamSeries>();
  for (const r of records ?? []) {
    if (r.type === 'machine_state') { stateRec = r; continue; }
    const s = seriesByType.get(r.type);
    if (s) {
      s.values.push(r.value);
      s.last = r.value; s.lastTs = r.timestamp;
      s.min = Math.min(s.min, r.value); s.max = Math.max(s.max, r.value);
      s.count += 1;
    } else {
      seriesByType.set(r.type, {
        type: r.type, unit: r.unit, values: [r.value],
        last: r.value, lastTs: r.timestamp, min: r.value, max: r.value, count: 1,
      });
    }
  }

  const grouped = new Map<Subsystem, ParamSeries[]>();
  for (const s of seriesByType.values()) {
    const key = subsystemOf(s.type);
    const arr = grouped.get(key) ?? [];
    arr.push(s);
    grouped.set(key, arr);
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => orderOf(a.type) - orderOf(b.type) || a.type.localeCompare(b.type));
  }

  const chip = 'rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50';

  return (
    <div className="space-y-4">
      <MachineStateBadge rec={stateRec} loading={records === null} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-slate-400">С</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-slate-400">По</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm" />
        </label>
        <div className="flex gap-1">
          <button type="button" onClick={() => { const t = todayYmd(); setFrom(t); setTo(t); }} className={chip}>Сегодня</button>
          <button type="button" onClick={() => { setTo(todayYmd()); setFrom(shiftYmd(-6)); }} className={chip}>7 дней</button>
          <button type="button" onClick={() => { setTo(todayYmd()); setFrom(shiftYmd(-29)); }} className={chip}>30 дней</button>
        </div>
      </div>

      {invalid ? (
        <p className="text-xs text-rose-500">Дата «С» позже даты «По».</p>
      ) : error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Не удалось загрузить телеметрию: {error}</p>
      ) : records === null ? (
        <p className="text-sm text-slate-400">Загрузка…</p>
      ) : seriesByType.size === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Телеметрия за этот период не поступала. Подключите телематический бокс
          (Teltonika / Galileosky) — данные о двигателе и гидравлике появятся здесь автоматически.
        </p>
      ) : (
        <>
          {SUBSYSTEMS.map(({ key, title, icon: Icon }) => {
            const items = grouped.get(key);
            if (!items || items.length === 0) return null;
            return (
              <div key={key}>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Icon className="h-3.5 w-3.5" /> {title}
                </h3>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((s) => <ParamCard key={s.type} s={s} />)}
                </dl>
              </div>
            );
          })}
          <p className="text-3xs text-slate-400">Цветовые пороги — ориентировочные, калибруются по установке.</p>
        </>
      )}
    </div>
  );
}

function MachineStateBadge({ rec, loading }: { rec: TelemetryRecord | null; loading: boolean }) {
  const state = rec ? MACHINE_STATES[Math.round(rec.value)] : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Состояние машины</span>
      {loading ? (
        <span className="text-sm text-slate-400">…</span>
      ) : state ? (
        <>
          <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-medium', state.cls)}>{state.label}</span>
          <span className="text-3xs text-slate-400">{formatRelative(rec!.timestamp)}</span>
        </>
      ) : (
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm text-slate-400">Нет данных</span>
      )}
    </div>
  );
}

function ParamCard({ s }: { s: ParamSeries }) {
  const spec = PARAM_SPECS[s.type];
  const status = worst(statusOf(s.min, spec), statusOf(s.max, spec));
  const { text, unit } = renderValue(s.last, s.unit, spec);
  const showSpark = spec?.kind !== 'bool' && spec?.kind !== 'count' && s.values.length >= 2;
  return (
    <div className={cn('rounded-lg border bg-card px-3 py-2', STATUS_CARD[status])}>
      <dt className="truncate text-2xs text-slate-500" title={s.type}>{spec?.label ?? s.type}</dt>
      <div className="mt-0.5 flex items-end justify-between gap-2">
        <dd className={cn('font-mono text-lg leading-none tabular-nums', STATUS_VALUE[status])}>
          {text}{unit ? <span className="ml-1 text-xs text-slate-400">{unit}</span> : null}
        </dd>
        {showSpark && <Sparkline values={s.values} status={status} />}
      </div>
      <div className="mt-1 font-mono text-3xs text-slate-400">
        мин {formatNum(s.min)} · макс {formatNum(s.max)} · {formatRelative(s.lastTs)}
      </div>
    </div>
  );
}

function Sparkline({ values, status }: { values: number[]; status: Status }) {
  const w = 80;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={SPARK_STROKE[status]} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function renderValue(value: number, unit: string | null, spec?: ParamSpec): { text: string; unit: string } {
  if (spec?.kind === 'bool') return { text: value >= 0.5 ? 'Вкл' : 'Выкл', unit: '' };
  if (spec?.kind === 'count') return { text: String(Math.round(value)), unit: unit ?? '' };
  return { text: formatNum(value), unit: unit ?? '' };
}

function formatNum(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} дн назад`;
}
