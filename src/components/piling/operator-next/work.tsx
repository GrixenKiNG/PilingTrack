'use client';

import {useState, type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import type {ProductionEntryInput, PilePassportInput} from '@/components/piling/operator-mobile/api';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '@/components/piling/operator-mobile/ui';
import {WarningsPanel} from '@/components/piling/operator-mobile/warnings-panel';
import {EntriesList} from '@/components/piling/operator-mobile/screens/entries-list';
import {PilePassportForm} from '@/components/piling/operator-mobile/screens/pile-passport-form';
import {
  downtimeInterval, formatIntervalMinutes, hhmmAgo,
} from '@/components/piling/operator-mobile/downtime-interval';
import {ActionButton, ChoiceButton, NextActionCard, ReasonNote, StageTitle} from './parts';
import {WORDS} from './words';

type Mode = 'NONE' | 'PILES' | 'DRILLING' | 'DOWNTIME' | 'PASSPORT';

/**
 * Работа: запись выработки, простоя и паспорта сваи.
 *
 * ПОЧЕМУ МАРКА ВЫБИРАЕТСЯ КНОПКАМИ И С ПУСТОГО МЕСТА. В v7 форма выработки
 * заранее подставляла первую марку справочника, и новичок, нажав «Записать»,
 * отправлял не ту марку, не замечая этого (находка P0 №39). Здесь выбор стартует
 * пустым, марки — крупными кнопками, а кнопка записи погашена, пока выбор не
 * сделан, и рядом написано, чего не хватает.
 *
 * ПОЧЕМУ ФОРМА ЧИСТИТСЯ ТОЛЬКО ПО УСПЕХУ. Правило 6 задания: успех — это сервер
 * принял ИЛИ запись легла в очередь. Пока форма чистилась сразу, обрыв связи на
 * последней свае стирал введённое, и набирать приходилось по памяти.
 */
export function WorkScreenNext({
  state, busy, error, tabs, onSubmitEntry, onCorrect, onFinish, onOpenSafety, onOpenTab,
}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  tabs?: ReactNode;
  onSubmitEntry: (entry: ProductionEntryInput) => Promise<boolean>;
  onCorrect: (input: {
    entryId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; actual: number; reason: string;
  }) => Promise<boolean>;
  onFinish: () => void;
  onOpenSafety: (stage: 'TB_PILING' | 'TB_DRILLING') => void;
  onOpenTab: (tab: 'EQUIPMENT' | 'MORE') => void;
}) {
  const [mode, setMode] = useState<Mode>('NONE');
  const [reference, setReference] = useState('');
  const [count, setCount] = useState('');
  const [metersPerUnit, setMetersPerUnit] = useState('');
  const [started, setStarted] = useState('');
  const [ended, setEnded] = useState('');
  const [comment, setComment] = useState('');
  const [finishing, setFinishing] = useState(false);

  const clear = () => {
    setReference('');
    setCount('');
    setMetersPerUnit('');
    setStarted('');
    setEnded('');
    setComment('');
  };

  const open = (next: Mode) => {
    clear();
    setFinishing(false);
    setMode(next);
  };

  const safetyStage: 'TB_PILING' | 'TB_DRILLING' = mode === 'DRILLING' ? 'TB_DRILLING' : 'TB_PILING';
  const safetyDone = state.checklists.find((checklist) => checklist.stage === safetyStage)?.done ?? false;
  const needsSafety = (mode === 'PILES' || mode === 'DRILLING' || mode === 'PASSPORT') && !safetyDone;
  const permitBlocks = state.permit.blocks.map((block) => block.title);

  const drillVolume = Number(count || 0) * Number(metersPerUnit || 0);
  const grade = state.dictionaries.pileGrades.find((item) => item.id === reference);
  const pileMeters = grade?.lengthMm ? (Number(count || 0) * grade.lengthMm) / 1000 : 0;
  const interval = mode === 'DOWNTIME' ? downtimeInterval(started, ended) : null;

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
    if (!reference) return mode === 'PILES' ? 'Выберите марку сваи.' : mode === 'DRILLING' ? 'Выберите тип бурения.' : 'Выберите причину простоя.';
    if (mode === 'PILES' && !(Number(count) > 0)) return 'Укажите, сколько свай забито.';
    if (mode === 'DRILLING') {
      if (!(Number(count) > 0)) return 'Укажите, сколько скважин пробурено.';
      if (!(Number(metersPerUnit) > 0)) return 'Укажите метраж одной скважины.';
    }
    if (mode === 'DOWNTIME' && !interval) return 'Укажите начало и конец простоя: конец должен быть позже начала.';
    return undefined;
  };

  const reason = blockReason();

  const submit = async () => {
    let entry: ProductionEntryInput | null = null;
    if (mode === 'PILES') entry = {kind: 'PILES', pileGradeId: reference, count: Number(count), comment: comment.trim() || undefined};
    if (mode === 'DRILLING') entry = {kind: 'DRILLING', typeId: reference, count: Number(count), metersPerUnit: Number(metersPerUnit)};
    if (mode === 'DOWNTIME' && interval) {
      entry = {kind: 'DOWNTIME', reasonId: reference, startedAt: interval.startedAt, endedAt: interval.endedAt, comment: comment.trim() || undefined};
    }
    if (!entry) return;
    const ok = await onSubmitEntry(entry);
    if (ok) {
      clear();
      setMode('NONE');
    }
  };

  if (mode === 'NONE') {
    return (
      <Screen title="Работа" subtitle={state.assignment?.equipmentName} tabs={tabs}>
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
          <EntriesList entries={state.entries} busy={busy} onCorrect={onCorrect} />
        </Panel>

        <ErrorNote message={error} />
      </Screen>
    );
  }

  if (mode === 'PASSPORT') {
    if (needsSafety) {
      return (
        <Screen title="Сваи с паспортом" tabs={tabs}>
          <NextActionCard
            title="Сначала чек-лист ТБ"
            hint="Паспорт сваи открывается после инструктажа по безопасности работ."
            actionLabel="Пройти чек-лист ТБ"
            onAction={() => onOpenSafety('TB_PILING')}
          />
          <ActionButton label="Назад к смене" tone="ghost" onClick={() => setMode('NONE')} />
        </Screen>
      );
    }
    return (
      <Screen title="Сваи с паспортом" subtitle={state.assignment?.equipmentName} tabs={tabs}>
        <ActionButton label="Назад к смене" tone="ghost" onClick={() => setMode('NONE')} />
        <Panel>
          <PanelTitle>Паспорт сваи</PanelTitle>
          <p className="mt-1 text-2xs text-muted-foreground">
            Залоги нумеруются самим списком. «Отказ» в паспорте — это осадка сваи за залог (мм/удар),
            а не поломка машины.
          </p>
          <div className="mt-3">
            <PilePassportForm
              grades={state.dictionaries.pileGrades}
              busy={busy}
              onSubmit={async (pileGradeId, passport: PilePassportInput) => {
                const ok = await onSubmitEntry({kind: 'PILE_PASSPORT', pileGradeId, passport});
                if (ok) setMode('NONE');
                return ok;
              }}
            />
          </div>
        </Panel>
        <ErrorNote message={error} />
      </Screen>
    );
  }

  const options = mode === 'DRILLING' ? state.dictionaries.drillingTypes : state.dictionaries.downtimeReasons;
  const title = mode === 'PILES' ? WORDS.logPiles : mode === 'DRILLING' ? WORDS.logDrilling : WORDS.logDowntime;

  return (
    <Screen
      title={title}
      subtitle={state.assignment?.equipmentName}
      tabs={tabs}
      footer={(
        <ActionButton
          label={busy ? 'Записываем…' : 'Записать'}
          hint={mode === 'PILES' && pileMeters > 0 ? `Автоподсчёт: ${count} шт × ${(grade?.lengthMm ?? 0) / 1000} м = ${pileMeters.toFixed(1)} м.п.` : undefined}
          onClick={() => void submit()}
          disabled={busy || reason !== undefined}
          reason={reason}
        />
      )}
    >
      <ActionButton label="Назад к смене" tone="ghost" onClick={() => setMode('NONE')} />

      {mode === 'PILES' ? (
        <>
          <StageTitle hint="Марка не выбрана заранее — это делает человек, а не экран.">Марка сваи</StageTitle>
          <div className="space-y-2">
            {state.dictionaries.pileGrades.map((item) => (
              <ChoiceButton
                key={item.id}
                label={item.name}
                hint={item.lengthMm ? `длина ${item.lengthMm / 1000} м` : 'длина не указана'}
                selected={reference === item.id}
                onClick={() => setReference(item.id)}
              />
            ))}
          </div>
          <NumberField label="Сколько свай забито, шт" value={count} onChange={setCount} />
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
                selected={reference === item.id}
                onClick={() => setReference(item.id)}
              />
            ))}
          </div>
          <NumberField label="Сколько скважин, шт" value={count} onChange={setCount} />
          <NumberField label="Метраж одной скважины, м" value={metersPerUnit} onChange={setMetersPerUnit} decimal />
          {drillVolume > 0 ? (
            <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
              Автоподсчёт: {count} шт × {metersPerUnit} м = {drillVolume.toFixed(1)} м.п.
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
                selected={reference === item.id}
                onClick={() => setReference(item.id)}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TimeField label="Начало" value={started} onChange={setStarted} />
            <TimeField label="Конец" value={ended} onChange={setEnded} />
          </div>
          <button
            type="button"
            className="onx-step w-full rounded-lg border bg-card text-2xs font-semibold"
            onClick={() => {
              // Начало и конец считаются от «сейчас»: дату машинист не вводит,
              // переход через полночь разбирает общий модуль интервала.
              setEnded(hhmmAgo(0));
              setStarted(hhmmAgo(30));
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

      <label className="block">
        <span className="text-2xs font-medium text-muted-foreground">Комментарий, если нужно</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
        />
      </label>

      {needsSafety ? (
        <NextActionCard
          title="Нужен чек-лист ТБ"
          hint="Инструктаж по безопасности работ по этому виду работ обязателен до записи."
          actionLabel="Пройти чек-лист ТБ"
          onAction={() => onOpenSafety(safetyStage)}
        />
      ) : null}

      <ErrorNote message={error} />
    </Screen>
  );
}

function NumberField({label, value, onChange, decimal = false}: {
  label: string; value: string; onChange: (value: string) => void; decimal?: boolean;
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
    </label>
  );
}

function TimeField({label, value, onChange}: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">{label}, ЧЧ:ММ</span>
      <input
        type="time"
        aria-label={`${label}, ЧЧ:ММ`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
    </label>
  );
}
