'use client';

import {useState} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import type {ProductionEntryInput} from '../api';
import {BigButton, ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '../ui';
import {WarningsPanel} from '../warnings-panel';

type Tab = 'PILES' | 'DRILLING' | 'DOWNTIME';

const TABS: {value: Tab; label: string}[] = [
  {value: 'PILES', label: 'Сваи'},
  {value: 'DRILLING', label: 'Бурение'},
  {value: 'DOWNTIME', label: 'Простой'},
];

/**
 * Рабочий экран: учёт выработки по ходу смены.
 *
 * ПОЧЕМУ ЗАПИСЬ ПО ХОДУ, А НЕ ОТЧЁТ В КОНЦЕ. Отчёт, заполняемый в 19:00 по
 * памяти, — это оценка. Свая, отмеченная сразу, помнит время; простой,
 * отмеченный сразу, помнит причину.
 *
 * ПОЧЕМУ БУРЕНИЕ ВВОДИТСЯ КАК В ОТЧЁТЕ. Количество скважин и метры на одну,
 * объём считается умножением. Так это устроено в отчёте за смену; вводить одни
 * и те же данные двумя способами — это два разных числа в аналитике.
 */
export function WorkScreen({state, onLog, onFinish, onOpenSafety, busy, error}: {
  state: OperatorMobileState;
  onLog: (entry: ProductionEntryInput) => void;
  onFinish: () => void;
  onOpenSafety: (stage: 'TB_PILING' | 'TB_DRILLING') => void;
  busy: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<Tab>('PILES');
  const [reference, setReference] = useState('');
  const [count, setCount] = useState('');
  const [metersPerUnit, setMetersPerUnit] = useState('');
  const [hours, setHours] = useState('');
  const [comment, setComment] = useState('');

  // Смена вкладки очищает форму: марка сваи не имеет смысла в простое, а «5»
  // из поля свай, оставшееся в поле часов, — это ошибочный отчёт. Сброс живёт
  // в обработчике, а не в эффекте: эффект дал бы лишний цикл отрисовки.
  const switchTab = (next: Tab) => {
    setTab(next);
    setReference('');
    setCount('');
    setMetersPerUnit('');
    setHours('');
    setComment('');
  };

  const safetyDone = (stage: 'TB_PILING' | 'TB_DRILLING') =>
    state.checklists.find((checklist) => checklist.stage === stage)?.done ?? false;

  const needsSafety = (tab === 'PILES' && !safetyDone('TB_PILING'))
    || (tab === 'DRILLING' && !safetyDone('TB_DRILLING'));

  const options = tab === 'PILES'
    ? state.dictionaries.pileGrades
    : tab === 'DRILLING'
      ? state.dictionaries.drillingTypes
      : state.dictionaries.downtimeReasons;

  const grade = state.dictionaries.pileGrades.find((item) => item.id === reference);
  const pileMeters = grade?.lengthMm ? (Number(count || 0) * grade.lengthMm) / 1000 : 0;
  const drillVolume = Number(count || 0) * Number(metersPerUnit || 0);

  const ready = Boolean(reference) && (
    tab === 'PILES' ? Number(count) > 0
      : tab === 'DRILLING' ? Number(count) > 0 && Number(metersPerUnit) > 0
        : Number(hours) > 0
  );

  const submit = () => {
    if (tab === 'PILES') {
      onLog({kind: 'PILES', pileGradeId: reference, count: Number(count), comment: comment || undefined});
    } else if (tab === 'DRILLING') {
      onLog({kind: 'DRILLING', typeId: reference, count: Number(count), metersPerUnit: Number(metersPerUnit)});
    } else {
      onLog({kind: 'DOWNTIME', reasonId: reference, hours: Number(hours), comment: comment || undefined});
    }
    setCount('');
    setMetersPerUnit('');
    setHours('');
    setComment('');
  };

  return (
    <Screen
      title="Работа"
      subtitle={[
        state.assignment?.equipmentName,
        state.assignment?.siteName,
        state.shift ? `смена за ${new Date(state.shift.productionDate).toLocaleDateString('ru-RU')}` : null,
      ].filter(Boolean).join(' · ')}
      footer={(
        <>
          <BigButton onClick={submit} disabled={!ready || busy || needsSafety}>
            {busy ? 'Записываем…' : 'Записать'}
          </BigButton>
          <BigButton tone="ghost" onClick={onFinish}>Работа завершена</BigButton>
        </>
      )}
    >
      <WarningsPanel warnings={state.warnings} />

      <Panel tone={state.workAllowed ? 'ok' : 'danger'}>
        <PanelTitle tone={state.workAllowed ? 'ok' : 'danger'}>
          {state.workAllowed ? 'Работа разрешена' : 'Работы прекращают'}
        </PanelTitle>
        <div className="mt-2">
          <VolumeFact
            label="Свай за смену"
            count={state.production.piles.count}
            meters={state.production.piles.meters}
          />
          <VolumeFact
            label="Бурение"
            count={state.production.drilling.count}
            meters={state.production.drilling.meters}
          />
          <Fact label="Простой" value={state.production.downtimeHours.toFixed(1)} unit="ч" />
          {state.weather && state.weather.windMs !== null ? (
            <Fact label="Ветер" value={state.weather.windMs} unit="м/с" />
          ) : null}
        </div>
      </Panel>

      <div className="flex gap-1.5 rounded-lg bg-secondary p-1">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => switchTab(option.value)}
            className={cn(
              'min-h-10 flex-1 rounded-md text-sm font-medium transition-colors',
              tab === option.value ? 'border bg-card font-semibold shadow-xs' : 'text-muted-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {needsSafety ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">Нужен чек-лист ТБ</PanelTitle>
          <p className="mt-1 text-sm">
            {tab === 'PILES'
              ? 'Перед первой сваей за смену пройдите инструктаж по забивке.'
              : 'Перед первой скважиной за смену пройдите инструктаж по бурению.'}
          </p>
          <div className="mt-3">
            <BigButton onClick={() => onOpenSafety(tab === 'PILES' ? 'TB_PILING' : 'TB_DRILLING')}>
              Пройти чек-лист
            </BigButton>
          </div>
        </Panel>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">
              {tab === 'PILES' ? 'Марка сваи' : tab === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
            </span>
            <select
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
            >
              <option value="">Выберите…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>

          {tab !== 'DOWNTIME' ? (
            <NumberField
              label={tab === 'PILES' ? 'Свай, шт' : 'Скважин, шт'}
              value={count}
              onChange={setCount}
            />
          ) : null}

          {tab === 'DRILLING' ? (
            <NumberField label="Метров на одну скважину" value={metersPerUnit} onChange={setMetersPerUnit} decimal />
          ) : null}

          {tab === 'DOWNTIME' ? (
            <NumberField label="Длительность, часов" value={hours} onChange={setHours} decimal />
          ) : null}

          {tab === 'PILES' && grade?.lengthMm && Number(count) > 0 ? (
            <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
              Автоподсчёт: {count} шт × {grade.lengthMm / 1000} м = {pileMeters.toFixed(1)} м.п.
            </p>
          ) : null}
          {tab === 'DRILLING' && (count || metersPerUnit) ? (
            <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-medium text-info-strong">
              Автоподсчёт: {count || 0} шт × {metersPerUnit || 0} м = {drillVolume.toFixed(1)} м.п.
            </p>
          ) : null}

          {tab !== 'DRILLING' ? (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">Комментарий</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
              />
            </label>
          ) : null}
        </div>
      )}

      <ErrorNote message={error} />
    </Screen>
  );
}

function NumberField({label, value, onChange, decimal}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-2xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        step={decimal ? '0.1' : '1'}
        min={decimal ? '0.1' : '1'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-lg font-semibold tabular-nums shadow-xs"
      />
    </label>
  );
}
