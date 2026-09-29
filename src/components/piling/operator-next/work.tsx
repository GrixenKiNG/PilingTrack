'use client';

import {useState, type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import type {ProductionEntryInput, PilePassportInput} from '@/components/piling/operator-mobile/api';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '@/components/piling/operator-mobile/ui';
import {WarningsPanel} from '@/components/piling/operator-mobile/warnings-panel';
import {EntriesList} from '@/components/piling/operator-mobile/screens/entries-list';
import {
  downtimeInterval, formatIntervalMinutes, hhmmAgo,
} from '@/components/piling/operator-mobile/downtime-interval';
import {ActionButton, ChoiceButton, NextActionCard, ReasonNote, StageTitle} from './parts';
import {PassportForm} from './passport-form';
import {emptyFormFields, type FormMode, type PassportDraftData, type WorkDraft, type WorkMode} from './drafts';
import {WORDS} from './words';

/**
 * Работа: запись выработки, простоя и паспорта сваи.
 *
 * ПОЧЕМУ МАРКА ВЫБИРАЕТСЯ КНОПКАМИ И С ПУСТОГО МЕСТА. В v7 форма выработки
 * заранее подставляла первую марку справочника, и новичок, нажав «Записать»,
 * отправлял не ту марку, не замечая этого (находка P0 №39). Здесь выбор стартует
 * пустым, марки — крупными кнопками, а кнопка записи погашена, пока выбор не
 * сделан, и рядом написано, чего не хватает.
 *
 * ПОЧЕМУ ЧЕРНОВИК ЖИВЁТ СНАРУЖИ. Раньше поля были состоянием этого экрана,
 * и любой переход (вкладка «Техника», «Назад к смене», обязательный чек-лист ТБ)
 * размонтировал форму вместе с набранным. Теперь черновик хранится выше экранов
 * и очищается только после подтверждённой записи или явного «Очистить»
 * (находки №2 и №3 ревью).
 */
export function WorkScreenNext({
  state, busy, error, tabs, storageOk, draft, onDraftChange, passport, onPassportChange,
  onSubmitEntry, onCorrect, onFinish, onOpenSafety, onOpenTab,
}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  tabs?: ReactNode;
  /** Доступно ли хранилище черновиков — от этого зависит честная подсказка. */
  storageOk: boolean;
  draft: WorkDraft;
  onDraftChange: (updater: (current: WorkDraft) => WorkDraft) => void;
  /** Черновик паспорта сваи живёт в памяти оболочки — как и остальные формы. */
  passport: PassportDraftData;
  onPassportChange: (next: PassportDraftData) => void;
  onSubmitEntry: (entry: ProductionEntryInput) => Promise<boolean>;
  onCorrect: (input: {
    entryId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; actual: number; reason: string;
  }) => Promise<boolean>;
  onFinish: () => void;
  onOpenSafety: (stage: 'TB_PILING' | 'TB_DRILLING') => void;
  onOpenTab: (tab: 'EQUIPMENT' | 'MORE') => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const mode = draft.mode;
  const formMode: FormMode | null = mode === 'PILES' || mode === 'DRILLING' || mode === 'DOWNTIME' ? mode : null;
  const fields = formMode ? draft.forms[formMode] : emptyFormFields();

  const patchFields = (patch: Partial<typeof fields>) => {
    if (!formMode) return;
    onDraftChange((current) => ({
      ...current,
      forms: {...current.forms, [formMode]: {...current.forms[formMode], ...patch}},
    }));
  };

  /** Открыть форму. Черновик НЕ стирается: возвращение к форме возвращает ввод. */
  const open = (next: WorkMode) => {
    setFinishing(false);
    onDraftChange((current) => ({...current, mode: next}));
  };

  /**
   * Поля закрыты, пока команда в пути.
   *
   * Находка №3 ревью: успех отправки стирал то, что человек успел изменить после
   * нажатия. Пока ответа нет, менять нечего — и чистить по успеху безопасно.
   */
  const locked = busy;

  const safetyStage: 'TB_PILING' | 'TB_DRILLING' = mode === 'DRILLING' ? 'TB_DRILLING' : 'TB_PILING';
  const safetyDone = state.checklists.find((checklist) => checklist.stage === safetyStage)?.done ?? false;
  const needsSafety = (mode === 'PILES' || mode === 'DRILLING' || mode === 'PASSPORT') && !safetyDone;
  const permitBlocks = state.permit.blocks.map((block) => block.title);

  const drillVolume = Number(fields.count || 0) * Number(fields.metersPerUnit || 0);
  const grade = state.dictionaries.pileGrades.find((item) => item.id === fields.reference);
  const pileMeters = grade?.lengthMm ? (Number(fields.count || 0) * grade.lengthMm) / 1000 : 0;
  const interval = mode === 'DOWNTIME' ? downtimeInterval(fields.started, fields.ended) : null;

  /** Что мешает записать — одной строкой, чтобы кнопка не гасла молча (находка №5). */
  const blockReason = (): string | undefined => {
    if (needsSafety) return 'Сначала пройдите чек-лист ТБ по этому виду работ.';
    if (mode === 'PILES' || mode === 'DRILLING') {
      if (!state.permit.allowed) {
        return permitBlocks.length > 0
          ? `Запись выработки закрыта: ${permitBlocks.join('; ')}.`
          : 'Запись выработки сейчас закрыта. Простой и осмотр остаются доступны.';
      }
    }
    if (!fields.reference) {
      return mode === 'PILES' ? 'Выберите марку сваи.' : mode === 'DRILLING' ? 'Выберите тип бурения.' : 'Выберите причину простоя.';
    }
    if (mode === 'PILES' && !(Number(fields.count) > 0)) return 'Укажите, сколько свай забито.';
    if (mode === 'DRILLING') {
      if (!(Number(fields.count) > 0)) return 'Укажите, сколько скважин пробурено.';
      if (!(Number(fields.metersPerUnit) > 0)) return 'Укажите метраж одной скважины.';
    }
    if (mode === 'DOWNTIME' && !interval) return 'Укажите начало и конец простоя: конец должен быть позже начала.';
    return undefined;
  };

  const reason = blockReason();

  const submit = async () => {
    let entry: ProductionEntryInput | null = null;
    if (mode === 'PILES') {
      entry = {kind: 'PILES', pileGradeId: fields.reference, count: Number(fields.count), comment: fields.comment.trim() || undefined};
    }
    if (mode === 'DRILLING') {
      // Комментарий у бурения не передаётся: в контракте `ProductionEntryInput`
      // у `DRILLING` поля `comment` нет, и поле формы здесь не показывается.
      entry = {kind: 'DRILLING', typeId: fields.reference, count: Number(fields.count), metersPerUnit: Number(fields.metersPerUnit)};
    }
    if (mode === 'DOWNTIME' && interval) {
      entry = {kind: 'DOWNTIME', reasonId: fields.reference, startedAt: interval.startedAt, endedAt: interval.endedAt, comment: fields.comment.trim() || undefined};
    }
    if (!entry || !formMode) return;
    // Очистку полей и закрытие формы ведёт оболочка в защищённом цикле
    // (ревью №2): очистка — сразу по подтверждению, закрытие — по концу цикла,
    // чтобы позднее закрытие не стёрло ничего, что человек успел изменить.
    await onSubmitEntry(entry);
  };

  const options = mode === 'DRILLING' ? state.dictionaries.drillingTypes : state.dictionaries.downtimeReasons;
  const title = mode === 'NONE'
    ? 'Работа'
    : mode === 'PASSPORT'
      ? 'Сваи с паспортом'
      : mode === 'PILES' ? WORDS.logPiles : mode === 'DRILLING' ? WORDS.logDrilling : WORDS.logDowntime;
  const dirty = Boolean(fields.reference || fields.count || fields.metersPerUnit || fields.started || fields.ended || fields.comment);

  return (
    <Screen
      title={title}
      subtitle={state.assignment?.equipmentName}
      tabs={tabs}
      footer={mode === 'PILES' || mode === 'DRILLING' || mode === 'DOWNTIME' ? (
        <ActionButton
          label={busy ? 'Записываем…' : 'Записать'}
          hint={mode === 'PILES' && pileMeters > 0 ? `Автоподсчёт: ${fields.count} шт × ${(grade?.lengthMm ?? 0) / 1000} м = ${pileMeters.toFixed(1)} м.п.` : undefined}
          onClick={() => void submit()}
          disabled={busy || reason !== undefined}
          reason={reason}
        />
      ) : undefined}
    >
      {mode === 'NONE' && !storageOk ? (
        <p className="text-2xs text-muted-foreground">
          Черновик не сохранится при перезагрузке страницы: память браузера недоступна.
        </p>
      ) : null}
      {mode === 'NONE' ? (
        <>
          <NextActionCard
            title="Запишите результат работы"
            hint="Сваи, бурение и простой записываются сразу. Каждая запись уходит на сервер, а без связи — в очередь на устройстве."
            actionLabel={WORDS.logPiles}
            onAction={() => open('PILES')}
            disabled={busy}
          />

          <WarningsPanel warnings={state.warnings} />

          <Panel>
            <PanelTitle>Итоги смены</PanelTitle>
            <div className="mt-2">
              <VolumeFact label="Свай за смену" count={state.production.piles.count} meters={state.production.piles.meters} />
              <VolumeFact label="Лидерное бурение" count={state.production.drilling.count} meters={state.production.drilling.meters} />
              <Fact label="Простой" value={formatDowntimeHours(state.production.downtimeHours)} />
            </div>
          </Panel>

          <StageTitle>Записать</StageTitle>
          <div className="space-y-2">
            <ActionButton label={WORDS.logPiles} hint="Крупными кнопками: марка, количество, метраж посчитается сам" onClick={() => open('PILES')} disabled={busy} />
            <ActionButton label={WORDS.logDrilling} tone="ghost" onClick={() => open('DRILLING')} disabled={busy} />
            <ActionButton label={WORDS.logDowntime} tone="ghost" onClick={() => open('DOWNTIME')} disabled={busy} />
            <ActionButton label="Сваи с паспортом" tone="ghost" onClick={() => open('PASSPORT')} disabled={busy} />
          </div>

          <StageTitle hint="Происшествие и неисправность записываются на своих вкладках — они не про выработку, а про безопасность и технику.">
            Происшествие и неисправность
          </StageTitle>
          <div className="space-y-2">
            <ActionButton label={`Записать ${WORDS.incident.toLowerCase()}`} tone="ghost" onClick={() => onOpenTab('MORE')} />
            <ActionButton label={`Записать ${WORDS.fault.toLowerCase()}`} tone="ghost" onClick={() => onOpenTab('EQUIPMENT')} />
          </div>

          <div className="pt-1">
            {finishing ? (
              <div className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 p-3">
                <p className="text-sm font-bold">
                  {WORDS.finishWork}? Дальше — осмотр после работы, новую выработку записать будет нельзя.
                </p>
                <p className="text-2xs text-muted-foreground">
                  За смену: {state.production.piles.count} свай, {state.production.drilling.count} скважин, простой {formatDowntimeHours(state.production.downtimeHours)}.
                </p>
                <ActionButton label="Да, работа завершена" tone="danger" onClick={onFinish} disabled={busy} />
                <ActionButton label="Продолжить работу" tone="ghost" onClick={() => setFinishing(false)} />
              </div>
            ) : (
              <ActionButton label={WORDS.finishWork} tone="neutral" onClick={() => setFinishing(true)} disabled={busy} />
            )}
          </div>

          <StageTitle>Журнал записей смены</StageTitle>
          <Panel>
            <fieldset className="onx-gate" disabled={busy}>
              <EntriesList entries={state.entries} busy={busy} onCorrect={onCorrect} />
            </fieldset>
          </Panel>

          <ErrorNote message={error} />
        </>
      ) : null}

      {mode === 'PASSPORT' && needsSafety ? (
        <>
          <NextActionCard
            title="Сначала чек-лист ТБ"
            hint="Паспорт сваи открывается после инструктажа по безопасности работ."
            actionLabel="Пройти чек-лист ТБ"
            onAction={() => onOpenSafety('TB_PILING')}
          />
          <ActionButton label="Назад к смене" tone="ghost" onClick={() => open('NONE')} />
        </>
      ) : null}

      {/*
        Паспорт сваи — управляемая форма: значения — в памяти оболочки, форме
        приходят пропом и уходят колбэком (ревью №4, пункт A1). Персистенции
        через DOM нет вовсе; пока идёт отправка, поля закрыты fieldset'ом.
      */}
      <div hidden={mode !== 'PASSPORT' || needsSafety}>
        <ActionButton label="Назад к смене" tone="ghost" onClick={() => open('NONE')} />
        <Panel>
          <PanelTitle>Паспорт сваи</PanelTitle>
          <p className="mt-1 text-2xs text-muted-foreground">
            Залоги нумеруются самим списком. «Отказ» в паспорте — это осадка сваи за залог (мм/удар),
            а не поломка машины.
          </p>
          <div className="mt-3">
            <fieldset className="onx-gate" disabled={busy}>
              <PassportForm
                grades={state.dictionaries.pileGrades}
                busy={busy}
                value={passport}
                onChange={onPassportChange}
                onSubmit={async (pileGradeId, input: PilePassportInput) => {
                  const ok = await onSubmitEntry({kind: 'PILE_PASSPORT', pileGradeId, passport: input});
                  if (ok) open('NONE');
                  return ok;
                }}
              />
            </fieldset>
          </div>
          {!storageOk && mode === 'PASSPORT' ? (
            <p className="mt-2 text-2xs text-muted-foreground">
              Черновик не сохранится при перезагрузке страницы: память браузера недоступна.
            </p>
          ) : null}
        </Panel>
        {mode === 'PASSPORT' ? <ErrorNote message={error} /> : null}
      </div>

      {mode !== 'NONE' && mode !== 'PASSPORT' ? (
        <>
          <div className="flex gap-2">
            <ActionButton label="Назад к смене" tone="ghost" onClick={() => open('NONE')} disabled={locked} />
            {/* Черновик стирается только по воле человека: случайный уход с формы
                больше ничего не теряет. */}
            <ActionButton label="Очистить" tone="ghost" onClick={() => patchFields(emptyFormFields())} disabled={locked || !dirty} />
          </div>
          <p className="text-2xs text-muted-foreground">
            {storageOk
              ? 'Набранное сохраняется при переходах и переживёт перезагрузку страницы. Уйдёт только после подтверждённой записи.'
              : 'Черновик не сохранится при перезагрузке страницы: память браузера недоступна. Уйдёт только после подтверждённой записи.'}
          </p>

          {mode === 'PILES' ? (
            <>
              <StageTitle hint="Марка не выбрана заранее — это делает человек, а не экран.">Марка сваи</StageTitle>
              <div className="space-y-2">
                {state.dictionaries.pileGrades.map((item) => (
                  <ChoiceButton
                    key={item.id}
                    label={item.name}
                    hint={item.lengthMm ? `длина ${item.lengthMm / 1000} м` : 'длина не указана'}
                    selected={fields.reference === item.id}
                    onClick={() => patchFields({reference: item.id})}
                    disabled={locked}
                  />
                ))}
              </div>
              <NumberField label="Сколько свай забито, шт" value={fields.count} onChange={(value) => patchFields({count: value})} disabled={locked} />
            </>
          ) : null}

          {mode === 'DRILLING' ? (
            <>
              <StageTitle>Тип бурения</StageTitle>
              <div className="space-y-2">
                {options.map((item) => (
                  <ChoiceButton
                    key={item.id}
                    label={item.name}
                    selected={fields.reference === item.id}
                    onClick={() => patchFields({reference: item.id})}
                    disabled={locked}
                  />
                ))}
              </div>
              <NumberField label="Сколько скважин, шт" value={fields.count} onChange={(value) => patchFields({count: value})} disabled={locked} />
              <NumberField label="Метраж одной скважины, м" value={fields.metersPerUnit} onChange={(value) => patchFields({metersPerUnit: value})} decimal disabled={locked} />
              {drillVolume > 0 ? (
                <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
                  Автоподсчёт: {fields.count} шт × {fields.metersPerUnit} м = {drillVolume.toFixed(1)} м.п.
                </p>
              ) : null}
            </>
          ) : null}

          {mode === 'DOWNTIME' ? (
            <>
              <StageTitle>Причина простоя</StageTitle>
              <div className="space-y-2">
                {options.map((item) => (
                  <ChoiceButton
                    key={item.id}
                    label={item.name}
                    selected={fields.reference === item.id}
                    onClick={() => patchFields({reference: item.id})}
                    disabled={locked}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TimeField label="Начало" value={fields.started} onChange={(value) => patchFields({started: value})} disabled={locked} />
                <TimeField label="Конец" value={fields.ended} onChange={(value) => patchFields({ended: value})} disabled={locked} />
              </div>
              <button
                type="button"
                className="onx-quiet w-full rounded-lg border bg-card text-2xs font-semibold"
                disabled={locked}
                onClick={() => {
                  // Начало и конец считаются от «сейчас»: дату машинист не вводит,
                  // переход через полночь разбирает общий модуль интервала.
                  patchFields({ended: hhmmAgo(0), started: hhmmAgo(30)});
                }}
              >
                Простой за последние 30 минут
              </button>
              {interval ? (
                <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
                  Длительность: {formatIntervalMinutes(interval.minutes)}
                </p>
              ) : (
                <ReasonNote>Укажите начало и конец: конец должен быть позже начала. Ночная смена переходит через полночь — это учтено.</ReasonNote>
              )}
            </>
          ) : null}

          {/* У бурения комментария нет: в контракте `ProductionEntryInput` у
              `DRILLING` поля `comment` не существует, и показывать поле, которое
              никуда не уходит, значит обещать сохранение, которого не будет. */}
          {mode === 'DRILLING' ? null : (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">Комментарий, если нужно</span>
              <textarea
                value={fields.comment}
                disabled={locked}
                onChange={(event) => patchFields({comment: event.target.value})}
                rows={2}
                className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
              />
            </label>
          )}

          {needsSafety ? (
            <NextActionCard
              title="Нужен чек-лист ТБ"
              hint="Инструктаж по безопасности работ по этому виду работ обязателен до записи. Введённое сохранится — вернётесь и допишете."
              actionLabel="Пройти чек-лист ТБ"
              onAction={() => onOpenSafety(safetyStage)}
            />
          ) : null}

          <ErrorNote message={error} />
        </>
      ) : null}
    </Screen>
  );
}

function NumberField({label, value, onChange, decimal = false, disabled}: {
  label: string; value: string; onChange: (value: string) => void; decimal?: boolean; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        step={decimal ? '0.1' : '1'}
        min="0"
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
    </label>
  );
}

function TimeField({label, value, onChange, disabled}: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">{label}, ЧЧ:ММ</span>
      <input
        type="time"
        aria-label={`${label}, ЧЧ:ММ`}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
    </label>
  );
}
