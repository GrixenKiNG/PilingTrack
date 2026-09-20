'use client';

import {useMemo, useRef, useState} from 'react';
import {
  measureRequired,
  type ChecklistAnswer, type ChecklistItem, type ChecklistSection, type ChecklistView,
  type OperatorAnswer, type WorkWarning,
} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {uploadPhoto} from '../api';
import {BigButton, ErrorNote, Panel, PanelTitle, Screen} from '../ui';
import {WarningsPanel} from '../warnings-panel';
import type {KnownAnswer} from '../safety/known-answers';

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
 * Пункты раздела, которые закрываются одной кнопкой «весь раздел в норме».
 *
 * ПРАВИЛО ИСКЛЮЧЕНИЯ. Кнопка не трогает пункт, где неисправность требует
 * снимка, и пункт с обязательным замером. Это ровно те строки, где слепая
 * «норма» опасна: трещина в мачте, обрыв пряди троса, подтёк РВД, показание
 * счётчика. На них человек отвечает поимённо — и видит, что кнопка их не
 * закрыла.
 *
 * ПОЧЕМУ РАЗДЕЛ, А НЕ ВЕСЬ СПИСОК. Раздел из четырёх строк помещается на
 * экране целиком, и человек действительно может окинуть узел взглядом. Одна
 * кнопка на восемнадцать пунктов подтверждает не осмотр, а нажатие кнопки —
 * такую из v10 пришлось убирать.
 */
function bulkItems(
  section: ChecklistSection,
  known: Record<string, KnownAnswer>,
): ChecklistItem[] {
  return section.items.filter(
    (item) => !known[item.id] && !item.photoOnIssue && !measureRequired(item, 'OK'),
  );
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
  checklist, warnings, onSubmit, busy, error, commandId, onBack, lastMeter, known = {},
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
  /**
   * Пункты, ответ на которые система знает сама (см. safety/known-answers).
   * Человеку они показаны фактом, а не вопросом, и уходят ответом «норма»
   * с основанием в примечании.
   */
  known?: Record<string, KnownAnswer>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [showGaps, setShowGaps] = useState(false);
  /**
   * Раскрыт ровно один раздел.
   *
   * Оператор в перчатке смотрит на машину, а не в телефон: открытый список из
   * восемнадцати строк он закрывает не глядя. Один узел на экране — это и есть
   * тот обход, который он делает ногами. Такой же порядок на осмотре в v2:
   * два экрана одной смены обязаны отвечать одинаково.
   */
  const [openSection, setOpenSection] = useState<string | null>(null);

  const items = useMemo(
    () => checklist.sections.flatMap((section) => section.items),
    [checklist.sections],
  );

  const update = (itemId: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({...current, [itemId]: {...(current[itemId] ?? emptyDraft()), ...patch}}));
  };

  const answered = items.filter((item) => known[item.id] || drafts[item.id]?.answer).length;
  const gaps = useMemo(() => collectGaps(items, drafts, known), [items, drafts, known]);

  /** Отметить весь раздел нормой или снять отметку, поставленную галочкой. */
  const answerSection = (section: ChecklistSection, value: OperatorAnswer | undefined) => {
    setDrafts((current) => {
      const next = {...current};
      for (const item of bulkItems(section, known)) {
        next[item.id] = {...(next[item.id] ?? emptyDraft()), answer: value};
      }
      return next;
    });
  };

  /** Ответ на все пункты раздела есть — раздел закрыт. */
  const sectionDone = (section: ChecklistSection) => section.items.every(
    (item) => known[item.id] || drafts[item.id]?.answer,
  );

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
      const fact = known[item.id];
      return {
        itemId: item.id,
        answer: fact ? ('OK' as OperatorAnswer) : (draft.answer as OperatorAnswer),
        // Основание системного ответа уходит в журнал: проверяющий через
        // полгода должен отличать подтверждённое человеком от вычисленного.
        note: fact ? `Подтверждено системой: ${fact.fact}` : draft.note.trim() || undefined,
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
          {showGaps && gaps.length > 0 ? (
            <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-2xs font-semibold text-warning-strong">
              Первый незаполненный пункт: {gaps[0]}
            </p>
          ) : (
            <p className="text-center text-2xs font-medium text-muted-foreground">
              Отмечено {answered} из {items.length}
            </p>
          )}
          <BigButton onClick={submit} disabled={busy}>
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

      <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
        {checklist.sections.map((section, index) => {
          const bulk = bulkItems(section, known);
          const bulkOn = bulk.length > 0 && bulk.every((item) => drafts[item.id]?.answer === 'OK');
          const apart = section.items.length - bulk.length;
          const done = sectionDone(section);
          const answered = section.items.filter(
            (item) => known[item.id] || drafts[item.id]?.answer,
          ).length;
          const open = openSection === section.id;

          /** Закрыли раздел галочкой — открываем следующий незакрытый сам. */
          const advance = () => {
            const rest = checklist.sections.slice(index + 1);
            setOpenSection(rest.find((next) => !sectionDone(next))?.id ?? null);
          };

          return (
            <li key={section.id}>
              <div className="flex items-stretch">
                {/*
                  Галочка отдельной кнопкой, а не по всей строке: касание по
                  названию раскрывает раздел, касание по галочке отвечает за
                  него. Одна кнопка на два действия заставляла бы выбирать
                  между «посмотреть» и «подтвердить не глядя».
                */}
                <button
                  type="button"
                  aria-pressed={bulkOn}
                  aria-label={`Весь раздел «${section.title}» в норме`}
                  disabled={bulk.length === 0}
                  onClick={() => {
                    answerSection(section, bulkOn ? undefined : 'OK');
                    if (!bulkOn && apart === 0) advance();
                    else if (!bulkOn) setOpenSection(section.id);
                  }}
                  className="flex min-h-12 w-12 shrink-0 items-center justify-center disabled:opacity-40"
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-md border text-sm font-bold',
                      done
                        ? 'border-success bg-success text-white'
                        : answered > 0
                          ? 'border-info bg-info/15 text-info-strong'
                          : 'border-border bg-card',
                    )}
                  >
                    {done ? '✓' : ''}
                  </span>
                </button>

                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenSection(open ? null : section.id)}
                  className="flex min-h-12 flex-1 items-center gap-2 pr-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', done ? 'text-muted-foreground' : 'font-medium')}>
                      {section.title}
                    </span>
                    {/*
                      Почему галочка не работает — словами, а не серым цветом.

                      В разделе, где КАЖДЫЙ пункт требует снимка или замера,
                      отмечать разом нечего, и кнопка выключалась молча:
                      человек видел бледную галочку, нажимал, ничего не
                      происходило, и он шёл искать поломку телефона. Разделов
                      с таким составом в предсменном осмотре три из семи.
                    */}
                    {!open && apart > 0 ? (
                      <span className="block text-3xs text-muted-foreground">
                        {bulk.length > 0
                          ? `Со снимком и замером — отдельно (${apart})`
                          : 'Каждый пункт со снимком или замером — откройте раздел'}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                    {answered}/{section.items.length}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{open ? '⌄' : '›'}</span>
                </button>
              </div>

              {open ? (
                <div className="space-y-2 border-t bg-background/40 p-2.5">
                  {section.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      draft={drafts[item.id] ?? emptyDraft()}
                      known={known[item.id]}
                      commandId={commandId}
                      lastMeter={lastMeter}
                      onChange={(patch) => update(item.id, patch)}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ErrorNote message={error} />
    </Screen>
  );
}

function ItemCard({item, draft, commandId, onChange, lastMeter, known}: {
  item: ChecklistItem;
  draft: Draft;
  commandId: string;
  known?: KnownAnswer;
  onChange: (patch: Partial<Draft>) => void;
  lastMeter?: {engineHours: number; recordedAt: string} | null;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Пункт, на который ответила система, показан фактом, а не вопросом: кнопки
  // «Норма / Замечание / Отказ» здесь означали бы, что мнения расходятся.
  if (known) return <KnownCard item={item} known={known} />;
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
            {item.measure.max !== undefined
              ? ` (от ${item.measure.min ?? 0} до ${item.measure.max})`
              : ''}
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
/**
 * Пункт, ответ на который дала система. Всегда «норма» и всегда с основанием:
 * строка на экране — та же, что уйдёт в журнал примечанием.
 */
function KnownCard({item, known}: {item: ChecklistItem; known: KnownAnswer}) {
  return (
    <div className="rounded-lg border border-success/40 bg-success/5 p-3">
      <p className="text-sm font-medium leading-snug text-muted-foreground">{item.text}</p>
      <p className="mt-1.5 text-2xs font-semibold text-success-strong">
        Подтверждено системой · {known.fact}
      </p>
    </div>
  );
}

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

function collectGaps(
  items: ChecklistItem[],
  drafts: Record<string, Draft>,
  known: Record<string, KnownAnswer>,
): string[] {
  const gaps: string[] = [];
  for (const item of items) {
    if (known[item.id]) continue;
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
