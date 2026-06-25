'use client';

/**
 * MaintenancePlansPanel — регламенты планового ТО (PM scheduler, P3) по
 * установке. Живёт на /admin/to под журналом наработки: HOURS-регламенты
 * считаются от последнего показания. Показывает статус срока (норма / скоро /
 * просрочено) и даёт добавить/удалить регламент. Сами наряды создаёт воркер.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PmDueStatus } from '@/lib/pm-due';

interface PlanDue {
  status: PmDueStatus;
  targetHours: number | null;
  hoursRemaining: number | null;
  daysRemaining: number | null;
}

interface Plan {
  id: string;
  title: string;
  type: string;
  triggerType: 'HOURS' | 'CALENDAR';
  intervalHours: number | null;
  intervalDays: number | null;
  isActive: boolean;
  due: PlanDue;
}

const DUE_META: Record<PmDueStatus, { label: string; cls: string }> = {
  ok: { label: 'норма', cls: 'border-slate-200 bg-slate-50 text-slate-500' },
  due_soon: { label: 'скоро ТО', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  overdue: { label: 'просрочено', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};

function dueDetail(p: Plan): string {
  if (p.triggerType === 'HOURS') {
    if (p.due.hoursRemaining == null) return `каждые ${p.intervalHours ?? '—'} м/ч`;
    return p.due.hoursRemaining >= 0
      ? `осталось ${p.due.hoursRemaining} м/ч`
      : `перебег ${Math.abs(p.due.hoursRemaining)} м/ч`;
  }
  if (p.due.daysRemaining == null) return `каждые ${p.intervalDays ?? '—'} дн.`;
  return p.due.daysRemaining >= 0 ? `через ${p.due.daysRemaining} дн.` : `просрочка ${Math.abs(p.due.daysRemaining)} дн.`;
}

export function MaintenancePlansPanel({ equipmentId }: { equipmentId: string }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [trigger, setTrigger] = useState<'HOURS' | 'CALENDAR'>('HOURS');
  const [interval, setIntervalValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (eqId: string) => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/maintenance-plans?equipmentId=${encodeURIComponent(eqId)}`);
      if (!res.ok) throw new Error('plans');
      setPlans(((await res.json()).plans ?? []) as Plan[]);
    } catch {
      setPlans([]);
      toast.error('Не удалось загрузить регламенты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / equipment change; the async loader sets state
    if (equipmentId) void load(equipmentId);
  }, [equipmentId, load]);

  const resetForm = () => {
    setTitle('');
    setTrigger('HOURS');
    setIntervalValue('');
    setFormOpen(false);
  };

  const submit = async () => {
    const n = Number(interval);
    if (!title.trim()) return toast.error('Введите название регламента');
    if (!Number.isInteger(n) || n <= 0) return toast.error('Интервал должен быть целым числом > 0');
    setSubmitting(true);
    try {
      const res = await authFetch('/api/maintenance-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId,
          title: title.trim(),
          triggerType: trigger,
          ...(trigger === 'HOURS' ? { intervalHours: n } : { intervalDays: n }),
        }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? 'Не удалось сохранить регламент';
        throw new Error(msg);
      }
      toast.success('Регламент добавлен');
      resetForm();
      await load(equipmentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить регламент');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Удалить регламент?')) return;
    try {
      const res = await authFetch(`/api/maintenance-plans/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      toast.success('Регламент удалён');
      await load(equipmentId);
    } catch {
      toast.error('Не удалось удалить регламент');
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Регламенты ТО</h3>
        <CalendarClock className="h-5 w-5 text-blue-600" />
      </div>

      {!formOpen && (
        <Button variant="outline" size="sm" className="mb-3 h-9 w-full" onClick={() => setFormOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Добавить регламент
        </Button>
      )}

      {formOpen && (
        <div className="mb-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">Новый регламент</span>
            <button type="button" onClick={resetForm} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Напр. ТО-1 по моточасам" className="h-9" />
          <div className="flex gap-1 rounded-md border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setTrigger('HOURS')}
              className={cn('flex-1 rounded px-2 py-1 text-xs font-medium', trigger === 'HOURS' ? 'bg-blue-100 text-blue-700' : 'text-slate-500')}
            >
              По моточасам
            </button>
            <button
              type="button"
              onClick={() => setTrigger('CALENDAR')}
              className={cn('flex-1 rounded px-2 py-1 text-xs font-medium', trigger === 'CALENDAR' ? 'bg-blue-100 text-blue-700' : 'text-slate-500')}
            >
              По календарю
            </button>
          </div>
          <Input
            type="number"
            min={1}
            value={interval}
            onChange={(e) => setIntervalValue(e.target.value)}
            placeholder={trigger === 'HOURS' ? 'интервал, м/ч (напр. 250)' : 'интервал, дней (напр. 90)'}
            className="h-9"
          />
          <Button size="sm" className="h-9 w-full" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid h-20 place-items-center rounded-md bg-slate-50 text-sm text-slate-400">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </span>
        </div>
      ) : plans.length === 0 ? (
        <div className="grid min-h-16 place-items-center rounded-md bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">
          Регламентов пока нет
        </div>
      ) : (
        <ul className="space-y-1.5">
          {plans.map((p) => {
            const meta = DUE_META[p.due.status];
            return (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{p.title}</div>
                  <div className="text-2xs text-slate-500">
                    {p.triggerType === 'HOURS' ? 'моточасы' : 'календарь'} · {dueDetail(p)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn('rounded border px-1.5 py-0.5 text-2xs font-medium', meta.cls)}>{meta.label}</span>
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    aria-label="Удалить регламент"
                    className="text-slate-400 transition-colors hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
