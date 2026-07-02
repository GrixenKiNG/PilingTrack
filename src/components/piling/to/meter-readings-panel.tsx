'use client';

/**
 * MeterReadingsPanel — журнал показаний наработки (моточасы) по установке.
 * Живёт на /admin/to рядом с «Контекст установки». Источник истины наработки —
 * этот журнал; Equipment.engineHoursTotal обновляется на бэкенде как кэш
 * «последнего показания». onChanged даёт родителю обновить отображение наработки.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gauge, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface MeterReading {
  id: string;
  engineHours: number;
  recordedAt: string;
  source: 'MANUAL' | 'TELEMETRY';
  note: string;
}

const fmtDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Local YYYY-MM-DD for a date input default (today).
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function MeterReadingsPanel({
  equipmentId,
  onChanged,
}: {
  equipmentId: string;
  /** Latest engine-hours after a change (null when the journal is empty). Lets
   *  the parent patch the displayed наработка without re-fetching the cached list. */
  onChanged?: (latestHours: number | null) => void;
}) {
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [hours, setHours] = useState('');
  const [recordedAt, setRecordedAt] = useState(todayInput());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Returns the loaded list so callers can derive the latest reading.
  const load = useCallback(async (eqId: string): Promise<MeterReading[]> => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/equipment/${eqId}/meter-readings`);
      if (!res.ok) throw new Error('readings');
      const list = ((await res.json()).readings ?? []) as MeterReading[];
      setReadings(list);
      return list;
    } catch {
      setReadings([]);
      toast.error('Не удалось загрузить показания');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Readings come back ordered by recordedAt desc, so the first is the latest.
  const latestHours = (list: MeterReading[]): number | null => list[0]?.engineHours ?? null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / equipment change; the async loader sets state
    if (equipmentId) void load(equipmentId);
  }, [equipmentId, load]);

  const resetForm = () => {
    setHours('');
    setRecordedAt(todayInput());
    setNote('');
    setFormOpen(false);
  };

  const submit = async () => {
    const engineHours = Number(hours);
    if (!Number.isInteger(engineHours) || engineHours < 0) {
      toast.error('Введите целое число моточасов ≥ 0');
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/meter-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineHours, recordedAt, note }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? 'Не удалось сохранить показание';
        throw new Error(msg);
      }
      const result = await res.json();
      if (result.warning) toast.warning(result.warning);
      else toast.success('Показание добавлено');
      resetForm();
      const list = await load(equipmentId);
      onChanged?.(latestHours(list));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить показание');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить это показание?')) return;
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/meter-readings/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      toast.success('Показание удалено');
      const list = await load(equipmentId);
      onChanged?.(latestHours(list));
    } catch {
      toast.error('Не удалось удалить показание');
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Журнал наработки</h3>
        <Gauge className="h-5 w-5 text-blue-600" />
      </div>

      {!formOpen && (
        <Button variant="outline" size="sm" className="mb-3 h-9 w-full" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Добавить показание
        </Button>
      )}

      {formOpen && (
        <div className="mb-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Новое показание</span>
            <button type="button" onClick={resetForm} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <label className="mb-1 block text-2xs text-slate-500">Моточасы *</label>
            <Input
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="напр. 5670"
              className="h-9"
            />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-slate-500">Дата снятия</label>
            <Input type="date" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} className="h-9" />
          </div>
          <div>
            <label className="mb-1 block text-2xs text-slate-500">Примечание</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" className="h-9" />
          </div>
          <Button size="sm" className="h-9 w-full" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid h-24 place-items-center rounded-md bg-slate-50 text-sm text-slate-400">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </span>
        </div>
      ) : readings.length === 0 ? (
        <div className="grid min-h-20 place-items-center rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          Показаний пока нет
        </div>
      ) : (
        <ul className="space-y-1.5">
          {readings.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold text-slate-800">
                  {r.engineHours.toLocaleString('ru')} м.ч.
                </div>
                <div className="text-2xs text-slate-500">
                  {fmtDate(r.recordedAt)}
                  {r.source === 'TELEMETRY' ? ' · телеметрия' : ''}
                  {r.note ? ` · ${r.note}` : ''}
                </div>
              </div>
              {r.source === 'MANUAL' && (
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label="Удалить показание"
                  className="shrink-0 text-slate-400 transition-colors hover:text-rose-600"
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
