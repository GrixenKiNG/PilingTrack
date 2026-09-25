'use client';

/**
 * FuelPanel — журнал топлива по установке: долив в бак и остаток по указателю.
 * Живёт рядом с журналом наработки на /admin/to. Источник истины по топливу —
 * этот журнал; расход и л/моточас считает бэкенд из долива, остатка и объёма
 * бака (наработка для л/моточас берётся из журнала моточасов).
 *
 * Когда на бак поставят датчик, телеметрия начнёт писать сюда с source=TELEMETRY
 * и вытеснит ручной ввод — панель не меняется.
 */

import { useCallback, useEffect, useState } from 'react';
import { Fuel, Loader2, Plus, Trash2, X } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface FuelEntry {
  id: string;
  litersAdded: number | null;
  tankPercent: number | null;
  recordedAt: string;
  source: 'MANUAL' | 'TELEMETRY';
  note: string;
}

interface FuelSummary {
  tankLiters: number | null;
  litersAdded: number;
  startPercent: number | null;
  endPercent: number | null;
  engineHoursDelta: number | null;
  consumedLiters: number | null;
  perEngineHour: number | null;
  entryCount: number;
}

const fmtDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function FuelPanel({ equipmentId }: { equipmentId: string }) {
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [summary, setSummary] = useState<FuelSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [liters, setLiters] = useState('');
  const [percent, setPercent] = useState('');
  const [recordedAt, setRecordedAt] = useState(todayInput());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (eqId: string) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/equipment/${eqId}/fuel`);
      if (!res.ok) throw new Error('fuel');
      const data = await res.json();
      setEntries((data.entries ?? []) as FuelEntry[]);
      setSummary((data.summary ?? null) as FuelSummary | null);
    } catch {
      setEntries([]);
      setSummary(null);
      toast.error('Не удалось загрузить журнал топлива');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / equipment change
    if (equipmentId) void load(equipmentId);
  }, [equipmentId, load]);

  const resetForm = () => {
    setLiters('');
    setPercent('');
    setRecordedAt(todayInput());
    setNote('');
    setFormOpen(false);
  };

  const submit = async () => {
    if (liters.trim() === '' && percent.trim() === '') {
      toast.error('Укажите долив в литрах или остаток в %');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/fuel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          litersAdded: liters.trim() === '' ? null : Number(liters),
          tankPercent: percent.trim() === '' ? null : Number(percent),
          recordedAt,
          note,
        }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? 'Не удалось сохранить запись';
        throw new Error(msg);
      }
      toast.success('Запись добавлена');
      resetForm();
      await load(equipmentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить запись');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить эту запись?')) return;
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/fuel/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      toast.success('Запись удалена');
      await load(equipmentId);
    } catch {
      toast.error('Не удалось удалить запись');
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Журнал топлива</h3>
        <Fuel className="h-5 w-5 text-info-strong" />
      </div>

      {/* Сводка за 30 дней. Расход и л/моточас — прочерк, если бэкенд не смог
          посчитать (нет объёма бака или замеров остатка): честнее, чем ноль. */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <SummaryTile label="Долив, 30 дн." value={summary ? `${summary.litersAdded} л` : '—'} />
        <SummaryTile
          label="Расход, 30 дн."
          value={summary?.consumedLiters != null ? `${summary.consumedLiters} л` : '—'}
        />
        <SummaryTile
          label="л/моточас"
          value={summary?.perEngineHour != null ? `${summary.perEngineHour}` : '—'}
        />
      </div>
      {summary && summary.consumedLiters == null && (
        <p className="mb-3 text-2xs leading-snug text-muted-foreground">
          Расход не считается: нужен объём бака в карточке техники и замеры остатка в % на начало и конец периода.
        </p>
      )}

      {!formOpen && (
        <Button variant="outline" size="sm" className="mb-3 h-9 w-full" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Добавить запись
        </Button>
      )}

      {formOpen && (
        <div className="mb-3 space-y-2 rounded-md border border-border bg-muted p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Новая запись</span>
            <button type="button" onClick={resetForm} aria-label="Закрыть форму" title="Закрыть" className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-muted-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-2xs text-muted-foreground">Залито, л</label>
              <Input
                type="number"
                min={0}
                value={liters}
                onChange={(e) => setLiters(e.target.value)}
                placeholder="напр. 200"
                className="h-9"
              />
            </div>
            <div>
              <label className="mb-1 block text-2xs text-muted-foreground">Остаток, %</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="напр. 40"
                className="h-9"
              />
            </div>
          </div>
          <p className="text-2xs text-muted-foreground">Заполните хотя бы одно поле.</p>
          <div>
            <label className="mb-1 block text-2xs text-muted-foreground">Дата</label>
            <Input type="date" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} className="h-9" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-muted-foreground">Примечание</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" className="h-9" />
          </div>
          <Button size="sm" className="h-9 w-full" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid h-24 place-items-center rounded-md bg-muted text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </span>
        </div>
      ) : entries.length === 0 ? (
        <div className="grid min-h-20 place-items-center rounded-md bg-muted px-3 py-4 text-center text-sm text-muted-foreground">
          Записей по топливу пока нет
        </div>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {e.litersAdded != null ? `+${e.litersAdded} л` : ''}
                  {e.litersAdded != null && e.tankPercent != null ? ' · ' : ''}
                  {e.tankPercent != null ? `остаток ${e.tankPercent}%` : ''}
                </div>
                <div className="text-2xs text-muted-foreground">
                  {fmtDate(e.recordedAt)}
                  {e.source === 'TELEMETRY' ? ' · телеметрия' : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </div>
              </div>
              {e.source === 'MANUAL' && (
                <button
                  type="button"
                  onClick={() => remove(e.id)}
                  aria-label="Удалить запись"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive-strong"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted px-2 py-2">
      <div className="text-sm font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-2xs text-muted-foreground">{label}</div>
    </div>
  );
}
