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
import {emptyChecklistDraft, type ChecklistDraft, type ChecklistDrafts} from './drafts';
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

/**
 * Что было в пункте ДО массовой отметки раздела.
 *
 * ПОЧЕМУ ХРАНИМ СНИМОК. «Отменить» обязано вернуть прежнее, а не поставить
 * «норму» второй раз (находка №5 ревью: обработчик отмены снова писал `OK`).
 * Без снимка откатывать нечего. Снимок живёт в экране: он нужен только внутри
 * одного захода, ответы же хранятся выше — в черновиках оболочки.
 */
type BulkBackup = Record<string, Record<string, ChecklistDraft | undefined>>;

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
 *
 * ОТВЕТЫ ХРАНЯТСЯ ВЫШЕ ЭКРАНА. `key={checklist.stage}` пересоздаёт экран при
 * каждом возврате, и внутреннее состояние умирало бы вместе с ответами
 * (находка Д2 аудита). Экран управляемый: ответы приходят и меняются в оболочке.
 */
export function ChecklistRunScreen({
  checklist, warnings, busy, error, commandId, drafts, onDraftsChange,
  onSubmit, onBack, onExit, lastMeter, known = {},
}: {
  checklist: ChecklistView;
  warnings: WorkWarning[];
  busy: boolean;
  error: string | null;
  commandId: string;
  /** Ответы этапа: пункт → черновик. */
  drafts: ChecklistDrafts;
  onDraftsChange: (updater: (current: ChecklistDrafts) => ChecklistDrafts) => void;
  onSubmit: (answers: ChecklistAnswer[]) => void;
  onBack?: () => void;
  /**
   * «Отложить осмотр» для осмотра фазы (находка Д1 аудита).
   *
   * У обходного осмотра есть «Назад»; у фазового выхода не было вовсе, и без
   * связи осмотр нельзя было ни завершить, ни покинуть. Отложенный осмотр
   * остаётся несданным, ответы сохранены, а «Следующее действие» ведёт обратно.
   */
  onExit?: () => void;
  lastMeter?: {engineHours: number; recordedAt: string} | null;
  known?: Record<string, KnownAnswer>;
}) {
  const setDrafts = onDraftsChange;
  const [bulkBackup, setBulkBackup] = useState<BulkBackup>({});
  const [showGaps, setShowGaps] = useState(false);

  const items = useMemo(
    () => checklist.sections.flatMap((section) => section.items),
    [checklist.sections],
  );

  const update = (itemId: string, patch: Partial<ChecklistDraft>) => {
    setDrafts((current) => ({...current, [itemId]: {...(current[itemId] ?? emptyChecklistDraft()), ...patch}}));
  };

  /**
   * Добавить снимок к пункту.
   *
   * ПОЧЕМУ ОТДЕЛЬНОЙ ФУНКЦИЕЙ, А НЕ ПАТЧЕМ ИЗ ПРОПСОВ. Список снимков брался из
   * черновика на момент рендера: два снимка подряд (второй выбран, пока грузится
   * первый) перезаписывали друг друга, и в команду уходил только последний —
   * доказательство терялось (находка Д5 аудита). Здесь список берётся из
   * текущего состояния.
   */
  const addMedia = (itemId: string, mediaId: string) => {
    setDrafts((current) => {
      const draft = current[itemId] ?? emptyChecklistDraft();
      return {...current, [itemId]: {...draft, uploading: false, mediaIds: [...draft.mediaIds, mediaId]}};
    });
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
      .map((item) => buildAnswer(item, drafts[item.id] ?? emptyChecklistDraft(), known[item.id]));
    return validateChecklistRun(items, built);
  }, [items, drafts, known]);

  const problemByItem = new Map(problems.map((problem) => [problem.itemId, problem.message]));

  /**
   * Пункты, которые можно закрыть одной кнопкой.
   *
   * ПРАВИЛО ИСКЛЮЧЕНИЯ. Кнопка не трогает пункт, где неисправность требует
   * снимка, и пункт с обязательным замером: это ровно те строки, где слепая
   * «норма» опасна.
   */
  const bulkable = (section: ChecklistSection) => section.items.filter(
    (item) => !known[item.id] && !item.photoOnIssue && !measureRequired(item, 'OK'),
  );

  /**
   * Пункты, которые массовая отметка действительно заполнит.
   *
   * ПОЧЕМУ ТОЛЬКО НЕОТМЕЧЕННЫЕ. Раньше «Весь раздел — норма» переписывала и
   * уже отмеченные пункты: замечание или неисправность молча становились
   * «нормой», а примечания и замеры оставались — запись противоречила себе
   * (находка №5 ревью).
   */
  const bulkTargets = (section: ChecklistSection) => bulkable(section)
    .filter((item) => !drafts[item.id]?.answer);

  const applyBulk = (section: ChecklistSection) => {
    const targets = bulkTargets(section);
    if (targets.length === 0) return;
    const snapshot: Record<string, ChecklistDraft | undefined> = {};
    for (const item of targets) snapshot[item.id] = drafts[item.id];
    setBulkBackup((current) => ({...current, [section.id]: snapshot}));
    setDrafts((current) => {
      const next = {...current};
      for (const item of targets) next[item.id] = {...(next[item.id] ?? emptyChecklistDraft()), answer: 'OK'};
      return next;
    });
  };

  const cancelBulk = (section: ChecklistSection) => {
    const snapshot = bulkBackup[section.id];
    if (!snapshot) return;
    setDrafts((current) => {
      const next = {...current};
      for (const [itemId, draft] of Object.entries(snapshot)) {
        if (draft === undefined) delete next[itemId];
        else next[itemId] = draft;
      }
      return next;
    });
    setBulkBackup((current) => {
      const next = {...current};
      delete next[section.id];
      return next;
    });
  };

  const submit = () => {
    if (problems.length > 0) {
      setShowGaps(true);
      return;
    }
    onSubmit(items.map((item) => buildAnswer(item, drafts[item.id] ?? emptyChecklistDraft(), known[item.id])));
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
          {onExit ? (
            <ActionButton
              label="Отложить осмотр"
              hint="Ответы сохранятся — вернётесь и продолжите"
              disabled={busy}
              reason="Подождите: осмотр отправляется."
              onClick={onExit}
            />
          ) : null}
        </>
      )}
    >
      <div className={cn('onx-counter', remaining === 0 && 'is-done')} data-testid="inspection-counter">
        <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
        const canceled = Boolean(bulkBackup[section.id]);
        const canBulk = bulkTargets(section).length > 0;
        const doneCount = section.items.filter((item) => known[item.id] || drafts[item.id]?.answer).length;
        return (
          <Panel key={section.id}>
            <div className="flex items-start justify-between gap-3">
              <PanelTitle>
                {section.title}
                <span className="ml-2 align-middle text-sm font-medium text-muted-foreground">
                  {doneCount} из {section.items.length}
                </span>
              </PanelTitle>
              {canBulk || canceled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (canceled ? cancelBulk(section) : applyBulk(section))}
                  className={cn(
                    'onx-quiet shrink-0 rounded-lg border px-3 text-2xs font-semibold',
                    'disabled:cursor-not-allowed disabled:opacity-55',
                  )}
                >
                  {canceled ? 'Отменить' : 'Весь раздел — норма'}
                </button>
              ) : null}
            </div>
            {canceled ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Отмечены только пункты без ответа. Уже выбранные замечания и неисправности не тронуты.
              </p>
            ) : null}
            <ul className="mt-2 space-y-4">
              {section.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  draft={drafts[item.id] ?? emptyChecklistDraft()}
                  known={known[item.id]}
                  problem={problemByItem.get(item.id)}
                  lastMeter={lastMeter}
                  disabled={busy}
                  onChange={(patch) => update(item.id, patch)}
                  onAddMedia={addMedia}
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
  item, draft, known, problem, lastMeter, disabled, onChange, onAddMedia, commandId,
}: {
  item: ChecklistItem;
  draft: ChecklistDraft;
  known?: KnownAnswer;
  problem?: string;
  lastMeter?: {engineHours: number; recordedAt: string} | null;
  disabled: boolean;
  onChange: (patch: Partial<ChecklistDraft>) => void;
  onAddMedia: (itemId: string, mediaId: string) => void;
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
          <p className="text-base font-semibold leading-snug">{item.text}</p>
          {item.hint ? <p className="text-sm text-muted-foreground">{item.hint}</p> : null}
          {known ? (
            <p className="mt-1 text-sm text-success-strong">Подтверждено системой: {known.fact}</p>
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
                disabled={disabled}
                onClick={() => onChange({answer: option.value})}
              >
                {option.label}
              </button>
            ))}
          </div>

          {isIssue ? (
            <label className="block">
              <span className="text-base font-medium text-muted-foreground">
                Опишите, что именно не так
              </span>
              <textarea
                value={draft.note}
                disabled={disabled}
                onChange={(event) => onChange({note: event.target.value})}
                rows={2}
                className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
                placeholder="Например: подтёк на гидроцилиндре, капает"
              />
            </label>
          ) : null}

          {measure && measureNeeded ? (
            <label className="block">
              <span className="text-base font-medium text-muted-foreground">
                {measure.label}, {measure.unit}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                aria-label={`${measure.label}, ${measure.unit}`}
                disabled={disabled}
                value={draft.measures[measure.key] ?? ''}
                onChange={(event) => onChange({measures: {...draft.measures, [measure.key]: event.target.value}})}
                className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
              />
              {lastMeter && measure.key === 'engineHours' ? (
                <span className="mt-1 block text-base text-muted-foreground">
                  Прошлое показание: {lastMeter.engineHours} м/ч
                </span>
              ) : null}
            </label>
          ) : null}

          {isIssue && item.photoOnIssue ? (
            <div className="space-y-1.5">
              {/* Подтверждение и кнопка живут, пока пункт требует снимок: пока
                  блок исчезал после первого файла, человек не видел, что снимок
                  приложен, и не мог добавить второй. */}
              {draft.mediaIds.length > 0 ? (
                <p className="text-sm text-success-strong">Снимков приложено: {draft.mediaIds.length}</p>
              ) : null}
              <label className="onx-quiet flex cursor-pointer items-center justify-center rounded-lg border border-dashed px-3">
                {draft.uploading
                  ? 'Загружаем снимок…'
                  : draft.mediaIds.length > 0 ? 'Добавить ещё снимок' : 'Приложить фотографию'}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={disabled}
                  className="hidden"
                  onChange={async (event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    onChange({uploading: true, uploadError: null});
                    try {
                      const mediaId = await uploadPhoto({file, clientCommandId: commandId, itemId: item.id});
                      onAddMedia(item.id, mediaId);
                    } catch (uploadError) {
                      onChange({uploading: false, uploadError: humanError(uploadError)});
                    }
                  }}
                />
              </label>
              {draft.uploadError ? <ReasonNote>{draft.uploadError}</ReasonNote> : null}
              {needsPhoto ? (
                <ReasonNote>Фотография обязательна: по ней механик видит, что случилось.</ReasonNote>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {problem ? <p className="text-sm font-medium text-warning-strong">{problem}</p> : null}
    </li>
  );
}

function buildAnswer(item: ChecklistItem, draft: ChecklistDraft, known?: KnownAnswer): ChecklistAnswer {
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
