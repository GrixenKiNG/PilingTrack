'use client';

import {useMemo, useRef, useState} from 'react';
import {
  measureRequired,
  type ChecklistAnswer, type ChecklistItem, type ChecklistView,
  type OperatorAnswer, type WorkWarning,
} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {uploadPhoto} from '../api';
import {BigButton, ErrorNote, Panel, PanelTitle, Screen} from '../ui';
import {WarningsPanel} from '../warnings-panel';

const ANSWERS: {value: OperatorAnswer; label: string}[] = [
  {value: 'OK', label: 'Норма'},
  {value: 'REMARK', label: 'Замечание'},
  {value: 'FAULT', label: 'Отказ'},
];

interface Draft {
  answer?: OperatorAnswer;
  note: string;
  measures: Record<string, string>;
  mediaIds: string[];
  uploading: boolean;
}

const emptyDraft = (): Draft => ({note: '', measures: {}, mediaIds: [], uploading: false});

/**
 * Пустая строка — это не ноль. `Number('')` даёт 0, и без этой проверки
 * незаполненное поле долива считалось бы заполненным нулём.
 */
function filled(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw));
}

/**
 * Универсальный экран чек-листа: один и тот же для осмотра, ЕО и ТБ.
 *
 * ПОЧЕМУ СПИСОК С СЕКЦИЯМИ, А НЕ МАСТЕР ПО ОДНОМУ ПУНКТУ. Мастер экономит место
 * и отнимает картину целиком: сколько осталось и можно ли вернуться. На осмотре
 * возвращаться приходится постоянно — вспомнил про течь, увидев соседний пункт.
 * Секции по узлам дают ориентир: течь была «где-то в гидравлике».
 */
export function ChecklistScreen({
  checklist, warnings, onSubmit, busy, error, commandId, onBack, lastMeter,
}: {
  checklist: ChecklistView;
  warnings: WorkWarning[];
  onSubmit: (answers: ChecklistAnswer[]) => void;
  busy: boolean;
  error: string | null;
  /** Ключ команды. Нужен уже сейчас: к нему привязываются снимки. */
  commandId: string;
  onBack?: () => void;
  /**
   * Последнее показание счётчика моточасов — подсказка под полем ввода.
   * Счётчик не крутится назад, и человек, видящий прошлое число, замечает
   * опечатку сам: до отказа сервера, а не после.
   */
  lastMeter?: {engineHours: number; recordedAt: string} | null;
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

  const answered = items.filter((item) => drafts[item.id]?.answer).length;
  const gaps = useMemo(() => collectGaps(items, drafts), [items, drafts]);

  const submit = () => {
    if (gaps.length > 0) {
      setShowGaps(true);
      return;
    }
    onSubmit(items.map((item) => {
      const draft = drafts[item.id] ?? emptyDraft();
      const measures = Object.fromEntries(
        Object.entries(draft.measures)
          .filter(([, value]) => filled(value))
          .map(([key, value]) => [key, Number(value)] as const),
      );
      return {
        itemId: item.id,
        answer: draft.answer as OperatorAnswer,
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
        <>
          <p className="text-center text-2xs font-medium text-muted-foreground">
            Отмечено {answered} из {items.length}
          </p>
          <BigButton onClick={submit} disabled={busy || gaps.length > 0}>
            {busy ? 'Отправляем…' : gaps.length > 0 ? `Осталось заполнить: ${gaps.length}` : 'Завершить'}
          </BigButton>
          {onBack ? <BigButton tone="ghost" onClick={onBack}>Назад</BigButton> : null}
        </>
      )}
    >
      <WarningsPanel warnings={warnings} />

      {showGaps && gaps.length > 0 ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">Чек-лист не завершён</PanelTitle>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {gaps.slice(0, 5).map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </Panel>
      ) : null}

      {checklist.sections.map((section) => (
        <section key={section.id} className="space-y-2">
          <h2 className="border-b pb-1.5 pt-2 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </h2>
          {section.items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              draft={drafts[item.id] ?? emptyDraft()}
              commandId={commandId}
              lastMeter={lastMeter}
              onChange={(patch) => update(item.id, patch)}
            />
          ))}
        </section>
      ))}

      <ErrorNote message={error} />
    </Screen>
  );
}

function ItemCard({item, draft, commandId, onChange, lastMeter}: {
  item: ChecklistItem;
  draft: Draft;
  commandId: string;
  onChange: (patch: Partial<Draft>) => void;
  lastMeter?: {engineHours: number; recordedAt: string} | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const isIssue = draft.answer === 'REMARK' || draft.answer === 'FAULT';
  const wantsMeasure = Boolean(item.measure) && measureRequired(item, draft.answer ?? 'OK');

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
    <div
      className={cn(
        'rounded-lg border bg-card p-3 shadow-xs',
        draft.answer === 'REMARK' && 'border-warning/50',
        draft.answer === 'FAULT' && 'border-destructive/50',
      )}
    >
      <p className="text-sm font-medium leading-snug">{item.text}</p>
      {item.hint ? <p className="mt-1 text-2xs text-muted-foreground">{item.hint}</p> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.severity === 'ALERT' ? (
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-destructive">
            Критично
          </span>
        ) : null}
        {item.photoOnIssue ? (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-warning-strong">
            Фото
          </span>
        ) : null}
        {item.onlyWhen?.map((condition) => (
          <span
            key={condition}
            className="rounded-full border border-info/30 bg-info/10 px-2 py-0.5 text-3xs font-semibold uppercase tracking-wide text-info-strong"
          >
            {condition === 'FROST' ? 'Мороз' : condition === 'RAIN' ? 'Дождь' : condition === 'DARK' ? 'Темнота' : 'Ветер'}
          </span>
        ))}
      </div>

      <div className="mt-3 flex gap-1.5">
        {ANSWERS.map((answer) => (
          <button
            key={answer.value}
            type="button"
            onClick={() => onChange({answer: answer.value})}
            className={cn(
              'min-h-11 flex-1 rounded-md border bg-card text-sm font-medium text-muted-foreground transition-colors',
              draft.answer !== answer.value && 'hover:bg-secondary',
              draft.answer === 'OK' && answer.value === 'OK' && 'border-success bg-success/10 font-semibold text-success-strong',
              draft.answer === 'REMARK' && answer.value === 'REMARK' && 'border-warning bg-warning/10 font-semibold text-warning-strong',
              draft.answer === 'FAULT' && answer.value === 'FAULT' && 'border-destructive bg-destructive/10 font-semibold text-destructive',
            )}
          >
            {answer.label}
          </button>
        ))}
      </div>

      {wantsMeasure && item.measure ? (
        <label className="mt-3 block">
          <span className="text-2xs font-medium text-muted-foreground">
            {item.measure.label}, {item.measure.unit}
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={draft.measures[item.measure.key] ?? ''}
            onChange={(event) => onChange({
              measures: {...draft.measures, [item.measure?.key ?? '']: event.target.value},
            })}
            className="mt-1 h-11 w-full rounded-md border bg-card px-3 text-base font-semibold tabular-nums shadow-xs"
          />
          {/*
            Прошлое показание счётчика — только у моточасов: у долива
            жидкостей «сколько было в прошлый раз» смысла не имеет.
            Поле не заполняем заранее: подставленное значение отправят не
            глядя, и в журнале наработки появится вчерашняя цифра под
            сегодняшней датой.
          */}
          {item.measure.key === 'engineHours' && lastMeter ? (
            <MeterHint
              last={lastMeter}
              typed={draft.measures[item.measure.key]}
              unit={item.measure.unit}
            />
          ) : null}
        </label>
      ) : null}

      {isIssue ? (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">Что именно не так</span>
            <textarea
              value={draft.note}
              onChange={(event) => onChange({note: event.target.value})}
              rows={2}
              placeholder="Коротко: где, что видно"
              className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
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
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={draft.uploading}
                className={cn(
                  'min-h-11 w-full rounded-md border border-dashed bg-card text-sm font-medium text-muted-foreground',
                  draft.mediaIds.length > 0 && 'border-solid bg-secondary text-foreground',
                )}
              >
                {draft.uploading
                  ? 'Загружаем снимок…'
                  : draft.mediaIds.length > 0
                    ? `Снимков: ${draft.mediaIds.length}. Добавить ещё`
                    : 'Снять фото'}
              </button>
              <ErrorNote message={photoError} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Чего не хватает, чтобы закрыть список. Те же правила, что и на сервере. */
/**
 * Прошлое показание счётчика и предупреждение о движении назад.
 *
 * Счётчик моточасов не крутится обратно: меньшее значение — опечатка, и
 * принять её значит испортить и наработку, и планы ТО, которые от неё
 * зависят. Сервер такую цифру отклоняет, но узнать об этом после
 * заполнения всего списка — плохой способ. Здесь то же правило, только
 * видно сразу.
 */
function MeterHint({last, typed, unit}: {
  last: {engineHours: number; recordedAt: string};
  typed: string | undefined;
  unit: string;
}) {
  const when = new Date(last.recordedAt).toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit'});
  const value = typed?.trim() ?? '';
  const goesBack = value !== '' && Number.isFinite(Number(value)) && Number(value) < last.engineHours;
  return (
    <span
      className={cn(
        'mt-1 block text-2xs',
        goesBack ? 'font-semibold text-destructive' : 'text-muted-foreground',
      )}
    >
      {goesBack
        ? `Меньше прошлого показания (${last.engineHours} ${unit} от ${when}). Счётчик не крутится назад — проверьте цифру.`
        : `Прошлое показание: ${last.engineHours} ${unit} от ${when}`}
    </span>
  );
}

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
    if (item.measure && measureRequired(item, draft.answer) && !filled(draft.measures[item.measure.key])) {
      gaps.push(`«${item.text}» — укажите ${item.measure.label.toLowerCase()}`);
    }
  }
  return gaps;
}
