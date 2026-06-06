'use client';

/**
 * RunInspection — страница заполнения осмотра (/inspections/[id]).
 *
 * Self-fetch из GET /api/inspections/[id]. Отрисовывает пункты по секциям,
 * отслеживает ответы в state, считает LiveHealthScore, позволяет сохранить
 * черновик (PUT) или завершить осмотр (PUT → POST /complete).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { usePilingStore } from '@/lib/store';
import { computeHealthScore } from '@/modules/inspections/domain/inspection-logic';
import { healthScoreColor, LEVEL_LABEL, STATUS_LABEL, STATUS_STYLE, type InspectionLevel, type InspectionStatus } from './inspection-labels';
import { InspectionItemPhotos } from './inspection-item-photos';

// ---------- types ----------

type AnswerType = 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';

interface SnapItem {
  id: string;
  sectionTitle: string | null;
  text: string;
  answerType: AnswerType;
  unit: string | null;
  norm: string | null;
  provenance: string | null;
  required: boolean;
  photoRequired: boolean;
}

interface SavedAnswer {
  itemId: string;
  result: string;
  value: string | null;
  note: string | null;
  photoCount: number;
}

interface InspectionDetail {
  id: string;
  status: InspectionStatus;
  level: InspectionLevel;
  inspectionDate: string;
  shift: string | null;
  engineHours: number | null;
  healthScore: number | null;
  equipment: { id: string; name: string; model: string | null } | null;
  templateSnapshot: SnapItem[];
  answers: SavedAnswer[];
}

// ---------- per-item answer state ----------
interface ItemAnswer {
  result: string;
  value: string;
  note: string;
}

const emptyAnswer = (): ItemAnswer => ({ result: '', value: '', note: '' });

// ---------- answer controls ----------

function YesNoControl({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
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

function Status4Control({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
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

function DoneControl({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled: boolean }) {
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

function MeasureControl({
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

// ---------- main component ----------

export function RunInspection({ inspectionId }: { inspectionId: string }) {
  const router = useRouter();
  const currentUser = usePilingStore((s) => s.currentUser);

  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // answers keyed by itemId
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>({});
  // photo counts keyed by itemId
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});

  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  // sign dialog
  const [signedByName, setSignedByName] = useState('');
  const [showSign, setShowSign] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inspections/${inspectionId}`);
      if (!res.ok) throw new Error();
      const { inspection: data } = await res.json() as { inspection: InspectionDetail };
      setInspection(data);

      // Initialize answer state from saved answers
      const init: Record<string, ItemAnswer> = {};
      for (const item of data.templateSnapshot) {
        const saved = data.answers.find((a) => a.itemId === item.id);
        init[item.id] = {
          result: saved?.result ?? '',
          value: saved?.value ?? '',
          note: saved?.note ?? '',
        };
      }
      setAnswers(init);
      setSignedByName(currentUser?.name ?? '');
    } catch {
      toast.error('Не удалось загрузить осмотр');
    } finally {
      setLoading(false);
    }
  }, [inspectionId, currentUser]);

  useEffect(() => { void load(); }, [load]);

  const setAnswer = (itemId: string, patch: Partial<ItemAnswer>) => {
    setAnswers((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  };

  // Live health score
  const healthScore = useMemo(() => {
    if (!inspection) return 0;
    const snapItems = inspection.templateSnapshot.map((it) => ({
      id: it.id,
      answerType: it.answerType,
      required: it.required,
      photoRequired: it.photoRequired,
    }));
    const answerList = Object.entries(answers).map(([itemId, a]) => ({
      itemId,
      result: a.result,
      value: a.value || null,
      photoCount: photoCounts[itemId] ?? 0,
    }));
    return computeHealthScore(snapItems, answerList);
  }, [inspection, answers, photoCounts]);

  // Build payload for PUT
  const buildAnswerPayload = () => {
    if (!inspection) return [];
    return inspection.templateSnapshot.map((item) => {
      const a = answers[item.id] ?? emptyAnswer();
      return {
        itemId: item.id,
        result: item.answerType === 'MEASURE' ? (a.result || 'OK') : a.result,
        value: item.answerType === 'MEASURE' ? (a.value || null) : null,
        note: a.note || null,
        photoCount: photoCounts[item.id] ?? 0,
      };
    });
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/inspections/${inspectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: buildAnswerPayload() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Ошибка сохранения');
      toast.success('Черновик сохранён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const complete = async () => {
    if (!signedByName.trim()) {
      toast.error('Укажите имя для подписи');
      return;
    }
    setCompleting(true);
    try {
      // Save answers first
      const putRes = await authFetch(`/api/inspections/${inspectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: buildAnswerPayload() }),
      });
      if (!putRes.ok) throw new Error((await putRes.json()).error || 'Ошибка сохранения');

      // Complete
      const res = await authFetch(`/api/inspections/${inspectionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedByName: signedByName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка завершения');
      }
      toast.success('Осмотр завершён');
      router.push('/inspections');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCompleting(false);
      setShowSign(false);
    }
  };

  const isDone = inspection?.status === 'COMPLETED';
  const isBusy = saving || completing;

  // Group items by sectionTitle
  const sections = useMemo(() => {
    if (!inspection) return [];
    const map = new Map<string, SnapItem[]>();
    for (const item of inspection.templateSnapshot) {
      const key = item.sectionTitle ?? '';
      if (!map.has(key)) map.set(key, []);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
    }
    return Array.from(map.entries());
  }, [inspection]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 text-center text-sm text-slate-500">
        Осмотр не найден.{' '}
        <Link href="/inspections" className="text-orange-600 underline">К списку</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <Link
          href="/inspections"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Осмотры
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            {inspection.equipment?.name ?? '—'}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{LEVEL_LABEL[inspection.level]}</span>
            <span>{inspection.inspectionDate.slice(0, 10).split('-').reverse().join('.')}</span>
            {inspection.shift && <span>Смена: {inspection.shift}</span>}
            {inspection.engineHours != null && <span>{inspection.engineHours} мч</span>}
            <span className={cn('font-medium rounded px-1.5 py-0.5', STATUS_STYLE[inspection.status])}>
              {STATUS_LABEL[inspection.status]}
            </span>
          </div>
        </div>

        {/* Live health score */}
        <div className="text-right">
          <div className={cn('text-3xl font-bold tabular-nums', healthScoreColor(healthScore))}>
            {healthScore}
          </div>
          <div className="text-xs text-slate-400">Оценка состояния</div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {sections.map(([sectionTitle, items]) => (
          <div key={sectionTitle}>
            {sectionTitle && (
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {sectionTitle}
              </h2>
            )}
            <div className="space-y-4">
              {items.map((item) => {
                const ans = answers[item.id] ?? emptyAnswer();
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border bg-card px-3 py-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800 leading-snug">
                        {item.text}
                        {item.required && <span className="ml-1 text-rose-500">*</span>}
                      </p>
                      {item.provenance && (
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-2xs text-slate-500">
                          {item.provenance}
                        </span>
                      )}
                    </div>

                    {/* Answer control */}
                    {item.answerType === 'YES_NO' && (
                      <YesNoControl
                        value={ans.result}
                        onChange={(v) => setAnswer(item.id, { result: v })}
                        disabled={isDone}
                      />
                    )}
                    {item.answerType === 'STATUS4' && (
                      <Status4Control
                        value={ans.result}
                        onChange={(v) => setAnswer(item.id, { result: v })}
                        disabled={isDone}
                      />
                    )}
                    {item.answerType === 'DONE' && (
                      <DoneControl
                        value={ans.result}
                        onChange={(v) => setAnswer(item.id, { result: v })}
                        disabled={isDone}
                      />
                    )}
                    {item.answerType === 'MEASURE' && (
                      <MeasureControl
                        value={ans.value}
                        onChange={(v) => setAnswer(item.id, { value: v })}
                        unit={item.unit}
                        norm={item.norm}
                        disabled={isDone}
                      />
                    )}

                    {/* Note */}
                    <Textarea
                      rows={1}
                      placeholder="Примечание…"
                      value={ans.note}
                      disabled={isDone}
                      onChange={(e) => setAnswer(item.id, { note: e.target.value })}
                      className="mt-2 text-xs resize-none"
                    />

                    {/* Photos — always show; required items are visually marked */}
                    {item.photoRequired && (
                      <p className="mt-2 text-2xs text-amber-600 font-medium">Требуется фото</p>
                    )}
                    <InspectionItemPhotos
                      inspectionId={inspectionId}
                      itemId={item.id}
                      onCountChange={(n) =>
                        setPhotoCounts((prev) => ({ ...prev, [item.id]: n }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      {!isDone && (
        <div className="mt-6 space-y-3">
          <Button
            variant="outline"
            onClick={saveDraft}
            disabled={isBusy}
            className="w-full"
          >
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Сохранить черновик
          </Button>

          {!showSign ? (
            <Button
              onClick={() => setShowSign(true)}
              disabled={isBusy}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            >
              Завершить осмотр
            </Button>
          ) : (
            <div className="rounded-lg border bg-slate-50 p-4 space-y-3">
              <div>
                <Label htmlFor="ri-sign">Подписал</Label>
                <Input
                  id="ri-sign"
                  value={signedByName}
                  onChange={(e) => setSignedByName(e.target.value)}
                  placeholder="ФИО"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowSign(false)}
                  disabled={completing}
                  className="flex-1"
                >
                  Отмена
                </Button>
                <Button
                  onClick={complete}
                  disabled={completing || !signedByName.trim()}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                >
                  {completing && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                  Подтвердить
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
