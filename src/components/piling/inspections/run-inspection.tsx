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
import { ArrowLeft, Loader2 } from '@/components/piling/icons/unified-icons';
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
import { YesNoControl, Status4Control, DoneControl, MeasureControl } from './inspection-controls';

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
  /** Половина смены: осмотр приёмки или осмотр после работ. */
  phase: 'PRE_SHIFT' | 'POST_SHIFT' | null;
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

// ---------- main component ----------

/**
 * @param onExit куда возвращаться по «назад» и после подписи. Задан — осмотр
 *   открыт внутри экрана смены и никуда не уводит: закрываем слой и отдаём
 *   управление обратно. Не задан — это отдельная страница `/inspections/[id]`,
 *   и возврат идёт в список осмотров, как раньше.
 */
export function RunInspection({ inspectionId, onExit }: { inspectionId: string; onExit?: () => void }) {
  const router = useRouter();
  const currentUser = usePilingStore((s) => s.currentUser);

  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // answers keyed by itemId
  const [answers, setAnswers] = useState<Record<string, ItemAnswer>>({});
  // photo counts keyed by itemId
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  // expanded extras (note + photos) keyed by itemId — компактный вид: по умолчанию скрыто
  const [expandedExtras, setExpandedExtras] = useState<Record<string, boolean>>({});

  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  // sign dialog
  const [signedByName, setSignedByName] = useState('');
  const [showSign, setShowSign] = useState(false);

  // Текущий раздел («узел») при пошаговом обходе.
  const [step, setStep] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/inspections/${inspectionId}`);
      if (!res.ok) throw new Error();
      const { inspection: data } = await res.json() as { inspection: InspectionDetail };
      setInspection(data);

      // Initialize answer state from saved answers
      const init: Record<string, ItemAnswer> = {};
      // Счётчик фото — тоже из сохранённых ответов, а не только из виджета.
      // Виджет фото монтируется лишь у видимых пунктов, а при пошаговом обходе
      // виден один раздел: без этого сохранение черновика обнулило бы фото у
      // всех остальных, а полоса разделов показывала бы «осталось» там, где
      // фото давно снято.
      const initPhotos: Record<string, number> = {};
      for (const item of data.templateSnapshot) {
        const saved = data.answers.find((a) => a.itemId === item.id);
        init[item.id] = {
          result: saved?.result ?? '',
          value: saved?.value ?? '',
          note: saved?.note ?? '',
        };
        initPhotos[item.id] = saved?.photoCount ?? 0;
      }
      setAnswers(init);
      setPhotoCounts(initPhotos);
      setSignedByName(currentUser?.name ?? '');
    } catch {
      toast.error('Не удалось загрузить осмотр');
    } finally {
      setLoading(false);
    }
  }, [inspectionId, currentUser]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
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

  const saveDraft = async (options?: { silent?: boolean }) => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/inspections/${inspectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: buildAnswerPayload() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Ошибка сохранения');
      if (!options?.silent) toast.success('Черновик сохранён');
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
      if (onExit) onExit(); else router.push('/inspections');
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

  /**
   * Пошаговый обход по узлам.
   *
   * ЗАЧЕМ. Ежесменный осмотр установки с молотом — около ста пунктов. Одной
   * страницей это простыня, которую в шесть утра проходят не читая: человек
   * листает и жмёт «норма» подряд. Раздел за раз — тот же список, но обозримый,
   * и видно, сколько осталось.
   *
   * ЗАВЕРШЁННЫЙ ОСМОТР НЕ ДЕЛИТСЯ. Подписанный осмотр читают целиком — искать
   * в нём пункт, перелистывая пятнадцать экранов, незачем.
   */
  const stepped = !isDone && sections.length > 1;
  const current = Math.min(step, Math.max(sections.length - 1, 0));

  // Сколько в разделе осталось до того, чтобы осмотр можно было закрыть.
  // Правило то же, что на сервере (`findMissing`): обязательный пункт без
  // ответа и пункт без обязательного фото. Иначе полоса обещала бы одно, а
  // завершение требовало другого.
  const sectionProgress = useMemo(() => sections.map(([title, items]) => {
    let remaining = 0;
    for (const item of items) {
      const answered = item.answerType === 'MEASURE' || Boolean(answers[item.id]?.result);
      if (item.required && !answered) remaining += 1;
      if (item.photoRequired && (photoCounts[item.id] ?? 0) < 1) remaining += 1;
    }
    return { title, total: items.length, remaining };
  }), [sections, answers, photoCounts]);

  // Переход между разделами сохраняет черновик молча: сто ответов, потерянных
  // из-за уснувшего телефона, — это сто ответов заново.
  const goToStep = async (next: number) => {
    if (next === current || next < 0 || next >= sections.length) return;
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await saveDraft({ silent: true });
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8 text-center text-sm text-muted-foreground">
        Осмотр не найден.{' '}
        {onExit
          ? <button type="button" onClick={onExit} className="text-signal-strong underline">К смене</button>
          : <Link href="/inspections" className="text-signal-strong underline">К списку</Link>}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-28 field-type">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        {onExit ? (
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> К смене
          </button>
        ) : (
          <Link
            href="/inspections"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Осмотры
          </Link>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            {inspection.equipment?.name ?? '—'}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{LEVEL_LABEL[inspection.level]}</span>
            {/* Осмотр после работ короче предсменного и спрашивает другое —
                человек должен видеть, какой из двух перед ним. */}
            {inspection.phase === 'POST_SHIFT' && (
              <span className="rounded bg-signal/10 px-1.5 py-0.5 font-medium text-signal-strong">
                После смены
              </span>
            )}
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
          <div className="text-xs text-muted-foreground">Оценка состояния</div>
        </div>
      </div>

      {/* Полоса узлов: где я и что осталось. Номера — крупные, их жмут в перчатке. */}
      {stepped && (
        <nav aria-label="Разделы осмотра" className="mb-4">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-foreground">
              Раздел {current + 1} из {sections.length}
            </span>
            <span className="text-muted-foreground">
              {sectionProgress[current]?.remaining === 0
                ? 'раздел заполнен'
                : `осталось ${sectionProgress[current]?.remaining ?? 0}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sectionProgress.map((section, index) => (
              <button
                key={section.title || index}
                type="button"
                onClick={() => void goToStep(index)}
                aria-current={index === current ? 'step' : undefined}
                aria-label={`${section.title || `Раздел ${index + 1}`}: ${
                  section.remaining === 0 ? 'заполнен' : `осталось ${section.remaining}`}`}
                className={`h-9 min-w-9 rounded-lg border px-2 text-sm font-semibold transition ${
                  index === current
                    ? 'border-signal bg-signal text-white'
                    : section.remaining === 0
                      ? 'border-success/30 bg-success/10 text-success-strong'
                      : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Sections */}
      <div className="space-y-6">
        {(stepped ? sections.slice(current, current + 1) : sections).map(([sectionTitle, items]) => (
          <div key={sectionTitle}>
            {sectionTitle && (
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
                      <p className="text-sm font-medium text-foreground leading-snug">
                        {item.text}
                        {item.required && <span className="ml-1 text-destructive-strong">*</span>}
                      </p>
                      {item.provenance && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
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

                    {/* Примечание + фото — компактно: свёрнуто по умолчанию, авто-раскрыто
                        если уже есть примечание/фото или фото обязательно. */}
                    {(() => {
                      const photoN = photoCounts[item.id] ?? 0;
                      const showExtras =
                        expandedExtras[item.id] || !!ans.note || photoN > 0 || item.photoRequired;
                      if (!showExtras) {
                        return (
                          <button
                            type="button"
                            disabled={isDone}
                            onClick={() => setExpandedExtras((p) => ({ ...p, [item.id]: true }))}
                            className="mt-2 text-2xs text-muted-foreground hover:text-muted-foreground disabled:opacity-50"
                          >
                            + замечание / фото
                          </button>
                        );
                      }
                      return (
                        <>
                          <Textarea
                            rows={1}
                            placeholder="Примечание…"
                            value={ans.note}
                            disabled={isDone}
                            onChange={(e) => setAnswer(item.id, { note: e.target.value })}
                            className="mt-2 text-xs resize-none"
                          />
                          {item.photoRequired && (
                            <p className="mt-2 text-2xs text-warning-strong font-medium">Требуется фото</p>
                          )}
                          <InspectionItemPhotos
                            inspectionId={inspectionId}
                            itemId={item.id}
                            onCountChange={(n) =>
                              setPhotoCounts((prev) => ({ ...prev, [item.id]: n }))
                            }
                          />
                        </>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Переход между узлами */}
      {stepped && (
        <div className="mt-6 flex gap-2">
          <Button
            variant="outline"
            onClick={() => void goToStep(current - 1)}
            disabled={current === 0 || isBusy}
            className="min-h-12 flex-1"
          >
            Назад
          </Button>
          {current < sections.length - 1 && (
            <Button
              onClick={() => void goToStep(current + 1)}
              disabled={isBusy}
              aria-label={`Далее: ${sections[current + 1]?.[0] || `раздел ${current + 2}`}`}
              className="min-h-12 min-w-0 flex-[2] bg-signal hover:bg-signal-strong text-white"
            >
              {/* min-w-0 и на кнопке, и на строке: без него flex-элемент
                  растягивается под неразрывный текст, кнопка становится шире
                  экрана телефона и страница едет вбок. «Гидросистема и
                  двигатель (CAT C7.1 / Liebherr D936)» — 450 px при экране 375. */}
              <span className="min-w-0 truncate">
                Далее: {sections[current + 1]?.[0] || `раздел ${current + 2}`}
              </span>
            </Button>
          )}
        </div>
      )}

      {/* Actions */}
      {!isDone && (
        <div className="mt-6 space-y-3">
          <Button
            variant="outline"
            onClick={() => void saveDraft()}
            disabled={isBusy}
            className="w-full"
          >
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Сохранить черновик
          </Button>

          {/* Завершение — только на последнем узле: подписывать осмотр, не дойдя
              до конца обхода, незачем, а кнопка на каждом экране к этому зовёт. */}
          {stepped && current < sections.length - 1 ? null : !showSign ? (
            <Button
              onClick={() => setShowSign(true)}
              disabled={isBusy}
              className="w-full bg-signal hover:bg-signal-strong text-white"
            >
              Завершить осмотр
            </Button>
          ) : (
            <div className="rounded-lg border bg-muted p-4 space-y-3">
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
                  className="flex-1 bg-signal hover:bg-signal-strong text-white"
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
