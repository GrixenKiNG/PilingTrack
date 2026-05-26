'use client';

/**
 * EquipmentMonitoring — machine state + telemetry for one rig, in two modes:
 *   - "Сейчас": latest value per parameter (snapshot).
 *   - "Анализ за период": DB-aggregated min / avg / max / count per parameter
 *     over a chosen day or range (GET /api/telemetry?action=analysis).
 *
 * Self-contained (like EquipmentPhotos / EquipmentDocuments). No live box is
 * connected yet, so the telemetry area normally shows "ожидаем данные".
 * PARAM_SPECS is the single source of truth for label / subsystem / order /
 * thresholds / formatting; unknown signals fall back to Прочее. Threshold
 * ranges are provisional defaults — tune per equipment. Machine state is a
 * manual stand-in (not persisted) defaulting from the equipment kind, until
 * the box + state-derivation logic compute it from live signals.
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

const MACHINE_STATES: Array<{ code: number; label: string; cls: string }> = [
  { code: 0, label: 'Выключена', cls: 'bg-slate-200 text-slate-700' },
  { code: 1, label: 'Простой', cls: 'bg-amber-100 text-amber-700' },
  { code: 2, label: 'Движение', cls: 'bg-sky-100 text-sky-700' },
  { code: 3, label: 'Работа', cls: 'bg-emerald-100 text-emerald-700' },
  { code: 4, label: 'Бурение', cls: 'bg-teal-100 text-teal-700' },
  { code: 5, label: 'Забивка свай', cls: 'bg-indigo-100 text-indigo-700' },
  { code: 6, label: 'Извлечение', cls: 'bg-violet-100 text-violet-700' },
  { code: 7, label: 'Ошибка', cls: 'bg-rose-100 text-rose-700' },
  { code: 8, label: 'Обслуживание', cls: 'bg-orange-100 text-orange-700' },
];

const KIND_DEFAULT_STATE: Record<string, number> = {
  DRILLING_RIG: 4, PILE_DRIVER: 5, VIBRO_HAMMER: 5, HYBRID: 3, OTHER: 1,
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

const orderOf = (type: string) => PARAM_SPECS[type]?.order ?? 99;
const subsystemOf = (type: string) => PARAM_SPECS[type]?.subsystem ?? classifyByKeyword(type);

function groupBySubsystem<T extends { type: string }>(items: T[]): Map<Subsystem, T[]> {
  const grouped = new Map<Subsystem, T[]>();
  for (const it of items) {
    const key = subsystemOf(it.type);
    const arr = grouped.get(key) ?? [];
    arr.push(it);
    grouped.set(key, arr);
  }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => orderOf(a.type) - orderOf(b.type) || a.type.localeCompare(b.type));
  }
  return grouped;
}

interface Props {
  equipmentId: string;
  kind?: string;
}

export function EquipmentMonitoring({ equipmentId, kind }: Props) {
  const [stateCode, setStateCode] = useState<number>(() => KIND_DEFAULT_STATE[kind ?? 'OTHER'] ?? 1);
  const [mode, setMode] = useState<'now' | 'period'>('now');

  return (
    <div className="space-y-4">
      <MachineStateControl stateCode={stateCode} onChange={setStateCode} />

      <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
        <ModeButton active={mode === 'now'} onClick={() => setMode('now')}>Сейчас</ModeButton>
        <ModeButton active={mode === 'period'} onClick={() => setMode('period')}>Анализ за период</ModeButton>
      </div>

      {mode === 'now'
        ? <TelemetrySnapshot equipmentId={equipmentId} />
        : <TelemetryAnalysis equipmentId={equipmentId} />}
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-md px-3 py-1', active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
    >
      {children}
    </button>
  );
}

function MachineStateControl({ stateCode, onChange }: { stateCode: number; onChange: (code: number) => void }) {
  const state = MACHINE_STATES.find((s) => s.code === stateCode) ?? MACHINE_STATES[0];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Состояние машины</span>
      <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-medium', state.cls)}>{state.label}</span>
      <select
        value={stateCode}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm text-slate-700"
        aria-label="Выбрать состояние машины"
      >
        {MACHINE_STATES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode 1: latest snapshot
// ---------------------------------------------------------------------------

interface SnapshotRecord {
  id: string;
  type: string;
  value: number;
  unit: string | null;
  timestamp: string;
}

function TelemetrySnapshot({ equipmentId }: { equipmentId: string }) {
  const [records, setRecords] = useState<SnapshotRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const qs = new URLSearchParams({ equipmentId, from: from.toISOString(), to: to.toISOString(), limit: '1000' });
    authFetch(`/api/telemetry?${qs.toString()}`)
      .then(async (res) => {
        if (!res.ok) { setError(`Сервер вернул ${res.status}`); return; }
        const data = await res.json();
        setRecords(Array.isArray(data.records) ? data.records : []);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, [equipmentId]);

  if (error) return <ErrorBox error={error} />;
  if (records === null) return <Loading />;
  if (records.length === 0) return <EmptyTelemetry />;

  const latestByType = new Map<string, SnapshotRecord>();
  for (const r of records) {
    if (r.type === 'machine_state') continue;
    latestByType.set(r.type, r);
  }
  const grouped = groupBySubsystem([...latestByType.values()]);

  return (
    <Groups grouped={grouped} render={(p) => {
      const spec = PARAM_SPECS[p.type];
      const status = statusOf(p.value, spec);
      const { text, unit } = renderValue(p.value, p.unit, spec);
      return (
        <Card key={p.id} status={status} label={spec?.label ?? p.type} type={p.type}>
          <dd className={cn('mt-0.5 font-mono text-lg tabular-nums', STATUS_VALUE[status])}>
            {text}{unit ? <span className="ml-1 text-xs text-slate-400">{unit}</span> : null}
          </dd>
          <div className="text-3xs text-slate-400">{formatRelative(p.timestamp)}</div>
        </Card>
      );
    }} />
  );
}

// ---------------------------------------------------------------------------
// Mode 2: period analysis
// ---------------------------------------------------------------------------

interface AnalysisRow {
  type: string;
  count: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  unit: string | null;
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

function TelemetryAnalysis({ equipmentId }: { equipmentId: string }) {
  const [from, setFrom] = useState(shiftYmd(-6));
  const [to, setTo] = useState(todayYmd());
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalid = from > to;

  const load = useCallback(async () => {
    if (from > to) return;
    setRows(null);
    setError(null);
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59.999`).toISOString();
    const qs = new URLSearchParams({ action: 'analysis', equipmentId, from: fromIso, to: toIso });
    try {
      const res = await authFetch(`/api/telemetry?${qs.toString()}`);
      if (!res.ok) { setError(`Сервер вернул ${res.status}`); return; }
      const data = await res.json();
      setRows(Array.isArray(data.analysis) ? data.analysis : []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [equipmentId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const chip = 'rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50';
  const grouped = rows ? groupBySubsystem(rows) : null;

  return (
    <div className="space-y-3">
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
        <ErrorBox error={error} />
      ) : rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyTelemetry />
      ) : (
        <Groups grouped={grouped!} render={(r) => {
          const spec = PARAM_SPECS[r.type];
          const status = worst(statusOf(r.min, spec), statusOf(r.max, spec));
          return (
            <Card key={r.type} status={status} label={spec?.label ?? r.type} type={r.type}>
              <dd className={cn('mt-0.5 font-mono text-lg tabular-nums', STATUS_VALUE[status])}>
                {fmt(r.avg)}{r.unit ? <span className="ml-1 text-xs text-slate-400">{r.unit}</span> : null}
                <span className="ml-1 text-2xs font-sans text-slate-400">сред.</span>
              </dd>
              <div className="mt-0.5 font-mono text-2xs text-slate-500">мин {fmt(r.min)} · макс {fmt(r.max)}</div>
              <div className="text-3xs text-slate-400">{r.count} замеров</div>
            </Card>
          );
        }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Groups<T extends { type: string }>({
  grouped, render,
}: { grouped: Map<Subsystem, T[]>; render: (item: T) => React.ReactNode }) {
  return (
    <div className="space-y-4">
      {SUBSYSTEMS.map(({ key, title, icon: Icon }) => {
        const items = grouped.get(key);
        if (!items || items.length === 0) return null;
        return (
          <div key={key}>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Icon className="h-3.5 w-3.5" /> {title}
            </h3>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {items.map(render)}
            </dl>
          </div>
        );
      })}
    </div>
  );
}

function Card({
  status, label, type, children,
}: { status: Status; label: string; type: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-lg border bg-card px-3 py-2', STATUS_CARD[status])}>
      <dt className="truncate text-2xs text-slate-500" title={type}>{label}</dt>
      {children}
    </div>
  );
}

function ErrorBox({ error }: { error: string }) {
  return (
    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      Не удалось загрузить телеметрию: {error}
    </p>
  );
}

function Loading() {
  return <p className="text-sm text-slate-400">Загрузка…</p>;
}

function EmptyTelemetry() {
  return (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
      Телеметрия за этот период не поступала. Подключите телематический бокс
      (Teltonika / Galileosky) — данные о двигателе и гидравлике появятся здесь автоматически.
    </p>
  );
}

function renderValue(value: number, unit: string | null, spec?: ParamSpec): { text: string; unit: string } {
  if (spec?.kind === 'bool') return { text: value >= 0.5 ? 'Вкл' : 'Выкл', unit: '' };
  if (spec?.kind === 'count') return { text: String(Math.round(value)), unit: unit ?? '' };
  return { text: fmt(value), unit: unit ?? '' };
}

function fmt(n: number | null): string {
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
