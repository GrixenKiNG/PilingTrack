'use client';

import {useMemo, useState, type ChangeEvent} from 'react';
import {
  measureRequired,
  type ChecklistAnswer, type ChecklistItem, type ChecklistSection, type ChecklistView,
  type OperatorAnswer, type WorkWarning,
} from '@/modules/operator-mobile/contracts';
import {validateChecklistRun} from '@/modules/operator-mobile/domain/checklist-run';
import {cn} from '@/lib/utils';
import {uploadPhoto} from '@/components/piling/operator-mobile/api';
import {ErrorNote, Panel, PanelTitle, Screen} from '@/components/piling/operator-mobile/ui';
import {WarningsPanel} from '@/components/piling/operator-mobile/warnings-panel';
import type {KnownAnswer} from '@/components/piling/operator-mobile/safety/known-answers';
import {ActionButton, ReasonNote, StatusMark} from './parts';
import {humanError} from './words';

/**
 * Ответы осмотра.
 *
 * ПОЧЕМУ «НЕИСПРАВНОСТЬ», А НЕ «ОТКАЗ». В базовом экране ответ называется
 * «Отказ», и тем же словом в паспорте сваи назван ЗАМЕР осадки за залог:
 * новичок заносит измерение как поломку машины (находка №7). Здесь у ответа
 * одно имя — «Неисправность».
 */
const ANSWERS: {value: OperatorAnswer; label: string}[] = [
  {value: 'OK', label: 'Норма'},
  {value: 'REMARK', label: 'Замечание'},
  {value: 'FAULT', label: 'Неисправность'},
];

interface Draft {
  answer?: OperatorAnswer;
  note: string;
  measures: Record<string, string>;
  mediaIds: string[];
  uploading: boolean;
  uploadError: string | null;
}

const emptyDraft = (): Draft => ({note: '', measures: {}, mediaIds: [], uploading: false, uploadError: null});

/** Пустая строка — не ноль: `Number('')` даёт 0, и незаполненный долив сошёл бы за заполненный. */
function filled(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw));
}

/**
 * Экран осмотра с крупным счётчиком «Осталось отметить: N».
 *
 * СЧЁТЧИК ВЗЯТ ИЗ v5. Он отвечает на вопрос, который машинист задаёт себе на
 * каждом круге: «сколько ещё». Пока его не было, человек либо листал список
 * целиком, либо закрывал раздел «не глядя».
 */
export function ChecklistRunScreen({
  checklist, warnings, busy, error, commandId, onSubmit, onBack, lastMeter, known = {},
}: {
  checklist: ChecklistView;
  warnings: WorkWarning[];
  busy: boolean;
  error: string | null;
  commandId: string;
  onSubmit: (answers: ChecklistAnswer[]) => void;
  onBack?: () => void;
  lastMeter?: {engineHours: number; recordedAt: string} | null;
  known?: Record<string, KnownAnswer>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [showGaps, setShowGaps] = useState(false);

  const items = useMemo(
    () => checklist.sections.flatMap((section) => section.items),
    [checklist.sections],
  );

  const update = (itemId: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({...current, [itemId]: {...(current[itemId] ?? emptyDraft()), ...patch}}));
  };

  const answered = items.filter((item) => known[item.id] || drafts[item.id]?.answer).length;
  const remaining = items.length - answered;

  /**
   * Проверку заполнения берём у модуля, а не пишем заново: правило «неисправность
   * требует фотографии» должно отвечать одинаково на экране и на сервере.
   */
  const problems = useMemo(() => {
    // Проверяем только отмеченное: незаполненные пункты `validateChecklistRun`
    // сам назовёт «Пункт не заполнен», и подставлять за человека «норму» нельзя.
    const built = items
      .filter((item) => known[item.id] || drafts[item.id]?.answer)
      .map((item) => buildAnswer(item, drafts[item.id] ?? emptyDraft(), known[item.id]));
    return validateChecklistRun(items, built);
  }, [items, drafts, known]);

  const problemByItem = new Map(problems.map((problem) => [problem.itemId, problem.message]));

  /** Пункты, которые закрываются одной кнопкой: без снимка и без обязательного замера. */
  const bulkItems = (section: ChecklistSection) => section.items.filter(
    (item) => !known[item.id] && !item.photoOnIssue && !measureRequired(item, 'OK'),
  );

  const answerSection = (section: ChecklistSection) => {
    setDrafts((current) => {
      const next = {...current};
      for (const item of bulkItems(section)) {
        next[item.id] = {...(next[item.id] ?? emptyDraft()), answer: 'OK'};
      }
      return next;
    });
  };

  const submit = () => {
    if (problems.length > 0) {
      setShowGaps(true);
      return;
    }
    onSubmit(items.map((item) => buildAnswer(item, drafts[item.id] ?? emptyDraft(), known[item.id])));
  };

  return (
    <Screen
      title={checklist.title}
      subtitle={checklist.purpose}
      footer={(
        <>
          {showGaps && problems.length > 0 ? (
            <ReasonNote>
              Осталось отметить {remaining}. Ближайшее: {problems[0].message}
            </ReasonNote>
          ) : null}
          <ActionButton
            label={busy ? 'Отправляем…' : 'Завершить осмотр'}
            hint={remaining > 0 ? `Осталось отметить: ${remaining}` : 'Все пункты отмечены'}
            onClick={submit}
            disabled={busy}
          />
          {onBack ? <ActionButton label="Назад" tone="ghost" onClick={onBack} /> : null}
        </>
      )}
    >
      <div className={cn('onx-counter', remaining === 0 && 'is-done')} data-testid="inspection-counter">
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {remaining === 0 ? 'Осмотр отмечен' : 'Осталось отметить'}
        </span>
        <strong>{remaining}</strong>
      </div>

      <WarningsPanel warnings={warnings} />

      {showGaps && problems.length > 0 ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">Осмотр не завершён</PanelTitle>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {problems.slice(0, 5).map((problem) => (
              <li key={problem.itemId}>{problem.message}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {checklist.sections.map((section) => {
        const bulk = bulkItems(section);
        const bulkOn = bulk.length > 0 && bulk.every((item) => drafts[item.id]?.answer === 'OK');
        const doneCount = section.items.filter((item) => known[item.id] || drafts[item.id]?.answer).length;
        return (
          <Panel key={section.id}>
            <div className="flex items-start justify-between gap-3">
              <PanelTitle>
                {section.title}
                <span className="ml-2 align-middle text-2xs font-medium text-muted-foreground">
                  {doneCount} из {section.items.length}
                </span>
              </PanelTitle>
              {bulk.length > 0 ? (
                <button
                  type="button"
                  aria-pressed={bulkOn}
                  onClick={() => answerSection(section)}
                  className="onx-step shrink-0 rounded-lg border px-3 text-2xs font-semibold"
                >
                  {bulkOn ? 'Отменить' : 'Весь раздел — норма'}
                </button>
              ) : null}
            </div>
            <ul className="mt-2 space-y-4">
              {section.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  draft={drafts[item.id] ?? emptyDraft()}
                  known={known[item.id]}
                  problem={problemByItem.get(item.id)}
                  lastMeter={lastMeter}
                  onChange={(patch) => update(item.id, patch)}
                  commandId={commandId}
                />
              ))}
            </ul>
          </Panel>
        );
      })}

      <ErrorNote message={error} />
    </Screen>
  );
}

function ItemRow({
  item, draft, known, problem, lastMeter, onChange, commandId,
}: {
  item: ChecklistItem;
  draft: Draft;
  known?: KnownAnswer;
  problem?: string;
  lastMeter?: {engineHours: number; recordedAt: string} | null;
  onChange: (patch: Partial<Draft>) => void;
  commandId: string;
}) {
  const isIssue = draft.answer === 'REMARK' || draft.answer === 'FAULT';
  const needsPhoto = isIssue && Boolean(item.photoOnIssue) && draft.mediaIds.length === 0;
  const measure = item.measure;
  const measureNeeded = measure ? measureRequired(item, draft.answer ?? 'OK') : false;

  return (
    <li className="space-y-2" data-testid={`inspection-item-${item.id}`}>
      <div className="flex items-start gap-2">
        <StatusMark tone={known ? 'ok' : draft.answer === 'FAULT' ? 'danger' : draft.answer === 'REMARK' ? 'warning' : draft.answer === 'OK' ? 'ok' : 'idle'}>
          {known ? '✓' : draft.answer === 'FAULT' ? '✕' : draft.answer === 'REMARK' ? '!' : draft.answer === 'OK' ? '✓' : '·'}
        </StatusMark>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{item.text}</p>
          {item.hint ? <p className="text-2xs text-muted-foreground">{item.hint}</p> : null}
          {known ? (
            <p className="mt-1 text-2xs text-success-strong">Подтверждено системой: {known.fact}</p>
          ) : null}
        </div>
      </div>

      {!known ? (
        <>
          <div className="onx-answers">
            {ANSWERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.answer === option.value}
                onClick={() => onChange({answer: option.value})}
              >
                {option.label}
              </button>
            ))}
          </div>

          {isIssue ? (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">
                Опишите, что именно не так
              </span>
              <textarea
                value={draft.note}
                onChange={(event) => onChange({note: event.target.value})}
                rows={2}
                className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
                placeholder="Например: подтёк на гидроцилиндре, капает"
              />
            </label>
          ) : null}

          {measure && measureNeeded ? (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">
                {measure.label}, {measure.unit}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                aria-label={`${measure.label}, ${measure.unit}`}
                value={draft.measures[measure.key] ?? ''}
                onChange={(event) => onChange({measures: {...draft.measures, [measure.key]: event.target.value}})}
                className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
              />
              {lastMeter && measure.key === 'engineHours' ? (
                <span className="mt-1 block text-2xs text-muted-foreground">
                  Прошлое показание: {lastMeter.engineHours} м/ч
                </span>
              ) : null}
            </label>
          ) : null}

          {needsPhoto ? (
            <div className="space-y-1.5">
              <label className="onx-step flex cursor-pointer items-center justify-center rounded-lg border border-dashed px-3 text-2xs font-semibold">
                {draft.uploading ? 'Загружаем снимок…' : 'Приложить фотографию'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    onChange({uploading: true, uploadError: null});
                    try {
                      const mediaId = await uploadPhoto({file, clientCommandId: commandId, itemId: item.id});
                      onChange({uploading: false, mediaIds: [...draft.mediaIds, mediaId]});
                    } catch (uploadError) {
                      onChange({uploading: false, uploadError: humanError(uploadError)});
                    }
                  }}
                />
              </label>
              {draft.mediaIds.length > 0 ? (
                <p className="text-2xs text-success-strong">Снимков приложено: {draft.mediaIds.length}</p>
              ) : null}
              {draft.uploadError ? <ReasonNote>{draft.uploadError}</ReasonNote> : null}
              <ReasonNote>Фотография обязательна: по ней механик видит, что случилось.</ReasonNote>
            </div>
          ) : null}
        </>
      ) : null}

      {problem ? <p className="text-2xs font-medium text-warning-strong">{problem}</p> : null}
    </li>
  );
}

function buildAnswer(item: ChecklistItem, draft: Draft, known?: KnownAnswer): ChecklistAnswer {
  const measures = Object.fromEntries(
    Object.entries(draft.measures)
      .filter(([, value]) => filled(value))
      .map(([key, value]) => [key, Number(value)] as const),
  );
  return {
    itemId: item.id,
    answer: known ? 'OK' : (draft.answer ?? 'OK'),
    // Основание системного ответа уходит в журнал: проверяющий должен отличать
    // подтверждённое человеком от вычисленного.
    note: known ? `Подтверждено системой: ${known.fact}` : (draft.note.trim() || undefined),
    measures: Object.keys(measures).length > 0 ? measures : undefined,
    mediaIds: draft.mediaIds.length > 0 ? draft.mediaIds : undefined,
  };
}
