'use client';

import {useMemo, useRef, useState} from 'react';
import type {ChecklistAnswer, ChecklistItem, ChecklistView, WorkBlocker} from '@/modules/operator-mobile/contracts';
import {uploadPhoto} from '../api';
import {BigButton, ErrorNote, Panel, Screen} from '../ui';
import {BlockersPanel} from '../blockers-panel';

type Verdict = 'OK' | 'REMARK' | 'FAULT';

const VERDICTS: {value: Verdict; label: string; className: string; active: string}[] = [
  {value: 'OK', label: 'Норма', className: 'border-emerald-700 text-emerald-900', active: 'bg-emerald-700 text-white border-emerald-700'},
  {value: 'REMARK', label: 'Замечание', className: 'border-amber-600 text-amber-900', active: 'bg-amber-600 text-white border-amber-600'},
  {value: 'FAULT', label: 'Неисправность', className: 'border-red-700 text-red-900', active: 'bg-red-700 text-white border-red-700'},
];

interface Draft {
  answer?: Verdict;
  note: string;
  measures: Record<string, string>;
  mediaIds: string[];
  uploading: boolean;
}

const emptyDraft = (): Draft => ({note: '', measures: {}, mediaIds: [], uploading: false});

/**
 * Универсальный экран чек-листа: один и тот же для осмотра, ЕО и ТБ.
 *
 * ПОЧЕМУ СПИСОК, А НЕ МАСТЕР ПО ОДНОМУ ПУНКТУ. Мастер экономит место на экране
 * и отнимает у оператора картину целиком: сколько осталось, что уже отмечено,
 * можно ли вернуться. На осмотре из двенадцати пунктов вернуться приходится
 * постоянно — вспомнил про течь, увидев соседний пункт.
 *
 * ПОЧЕМУ ТРИ ОТВЕТА, А НЕ ЧЕТЫРЕ. «Не применимо» здесь нет: пункты, которых на
 * этой машине или при этой погоде быть не должно, отсеяны заранее. Кнопка
 * «неприменимо» на осмотре мачты — это способ не осматривать мачту.
 */
export function ChecklistScreen({checklist, blockers, onSubmit, busy, error, commandId, onBack}: {
  checklist: ChecklistView;
  blockers: WorkBlocker[];
  onSubmit: (answers: ChecklistAnswer[]) => void;
  busy: boolean;
  error: string | null;
  /** Ключ команды. Нужен уже сейчас: к нему привязываются снимки. */
  commandId: string;
  onBack?: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [showGaps, setShowGaps] = useState(false);

  const update = (itemId: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({...current, [itemId]: {...(current[itemId] ?? emptyDraft()), ...patch}}));
  };

  const answered = useMemo(
    () => checklist.items.filter((item) => drafts[item.id]?.answer).length,
    [checklist.items, drafts],
  );

  const gaps = useMemo(() => collectGaps(checklist.items, drafts), [checklist.items, drafts]);
  const ready = gaps.length === 0;

  const submit = () => {
    if (!ready) {
      setShowGaps(true);
      return;
    }
    onSubmit(checklist.items.map((item) => {
      const draft = drafts[item.id] ?? emptyDraft();
      const measures = Object.fromEntries(
        Object.entries(draft.measures)
          .filter(([, value]) => isFilledNumber(value))
          .map(([key, value]) => [key, Number(value)] as const),
      );
      return {
        itemId: item.id,
        answer: draft.answer as Verdict,
        note: draft.note.trim() || undefined,
        measures: Object.keys(measures).length > 0 ? measures : undefined,
        mediaIds: draft.mediaIds.length > 0 ? draft.mediaIds : undefined,
      };
    }));
  };

  return (
    <Screen
      title={checklist.title}
      subtitle={checklist.purpose}
      footer={(
        <div className="space-y-2">
          <p className="text-center text-base font-semibold">
            Отмечено {answered} из {checklist.items.length}
          </p>
          <BigButton onClick={submit} disabled={busy}>
            {busy ? 'Отправляем…' : 'Завершить'}
          </BigButton>
          {onBack ? <BigButton tone="ghost" onClick={onBack}>Назад</BigButton> : null}
        </div>
      )}
    >
      <BlockersPanel blockers={blockers} />

      {showGaps && gaps.length > 0 ? (
        <Panel tone="warning">
          <p className="text-base font-bold">Чек-лист не завершён</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-base">
            {gaps.slice(0, 5).map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </Panel>
      ) : null}

      {checklist.items.map((item, index) => (
        <ItemCard
          key={item.id}
          index={index + 1}
          item={item}
          draft={drafts[item.id] ?? emptyDraft()}
          commandId={commandId}
          onChange={(patch) => update(item.id, patch)}
        />
      ))}

      <ErrorNote message={error} />
    </Screen>
  );
}

function ItemCard({item, index, draft, commandId, onChange}: {
  item: ChecklistItem;
  index: number;
  draft: Draft;
  commandId: string;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const isIssue = draft.answer === 'REMARK' || draft.answer === 'FAULT';
  const measureRequired = item.measure
    && (item.measure.requiredOn ?? ['OK', 'REMARK', 'FAULT']).includes(draft.answer ?? 'OK');

  const attach = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    onChange({uploading: true});
    try {
      const mediaId = await uploadPhoto({file, clientCommandId: commandId, itemId: item.id});
      onChange({mediaIds: [...draft.mediaIds, mediaId], uploading: false});
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'Снимок не загрузился');
      onChange({uploading: false});
    }
  };

  return (
    <Panel tone={draft.answer === 'FAULT' ? 'stop' : draft.answer === 'REMARK' ? 'warning' : 'plain'}>
      <div className="flex gap-3">
        <span className="text-lg font-bold text-neutral-400 tabular-nums">{index}</span>
        <div className="flex-1">
          <h3 className="text-lg font-bold leading-snug">{item.text}</h3>
          {item.hint ? <p className="mt-1 text-base text-neutral-600">{item.hint}</p> : null}
          {item.blocking ? (
            <p className="mt-1 text-sm font-bold uppercase tracking-wide text-red-800">
              Неисправность останавливает работу
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict.value}
            type="button"
            onClick={() => onChange({answer: verdict.value})}
            className={`min-h-[56px] flex-1 rounded-xl border-2 px-1 text-base font-bold leading-tight ${
              draft.answer === verdict.value ? verdict.active : `bg-white ${verdict.className}`
            }`}
          >
            {verdict.label}
          </button>
        ))}
      </div>

      {measureRequired && item.measure ? (
        <MeasureField
          measure={item.measure}
          value={draft.measures[item.measure.key] ?? ''}
          onChange={(value) => onChange({
            measures: {...draft.measures, [item.measure?.key ?? '']: value},
          })}
        />
      ) : null}

      {isIssue ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-base font-semibold">Что именно не так</span>
            <textarea
              value={draft.note}
              onChange={(event) => onChange({note: event.target.value})}
              rows={2}
              className="mt-1 w-full rounded-xl border-2 border-neutral-900 p-3 text-base"
              placeholder="Коротко: где, что видно"
            />
          </label>

          {item.photoOnIssue ? (
            <div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => void attach(event.target.files?.[0])}
              />
              <BigButton tone="ghost" onClick={() => fileInput.current?.click()} disabled={draft.uploading}>
                {draft.uploading
                  ? 'Загружаем снимок…'
                  : draft.mediaIds.length > 0
                    ? `Снимков: ${draft.mediaIds.length}. Добавить ещё`
                    : 'Снять фото'}
              </BigButton>
              <ErrorNote message={photoError} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function MeasureField({measure, value, onChange}: {
  measure: NonNullable<ChecklistItem['measure']>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mt-3 block">
      <span className="text-base font-semibold">{measure.label}, {measure.unit}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-[56px] w-full rounded-xl border-2 border-neutral-900 px-3 text-xl font-bold tabular-nums"
      />
    </label>
  );
}

/**
 * Пустая строка — это не ноль. `Number('')` даёт 0, и без этой проверки
 * незаполненное поле долива считалось бы заполненным нулём.
 */
function isFilledNumber(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw));
}

/** Чего не хватает, чтобы закрыть список. Те же правила, что и на сервере. */
function collectGaps(items: ChecklistItem[], drafts: Record<string, Draft>): string[] {
  const gaps: string[] = [];
  for (const item of items) {
    const draft = drafts[item.id];
    if (!draft?.answer) {
      gaps.push(`«${item.text}» — не отмечен`);
      continue;
    }
    const isIssue = draft.answer === 'REMARK' || draft.answer === 'FAULT';
    if (isIssue && !draft.note.trim()) {
      gaps.push(`«${item.text}» — нужно описание`);
    }
    if (isIssue && item.photoOnIssue && draft.mediaIds.length === 0) {
      gaps.push(`«${item.text}» — нужен снимок`);
    }
    if (item.measure) {
      const required = (item.measure.requiredOn ?? ['OK', 'REMARK', 'FAULT']).includes(draft.answer);
      if (required && !isFilledNumber(draft.measures[item.measure.key])) {
        gaps.push(`«${item.text}» — укажите ${item.measure.label.toLowerCase()}`);
      }
    }
  }
  return gaps;
}
