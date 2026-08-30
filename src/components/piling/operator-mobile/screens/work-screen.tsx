'use client';

import {useEffect, useState} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import type {ProductionEntryInput} from '../api';
import {BigButton, ErrorNote, Fact, Panel, Screen} from '../ui';
import {BlockersPanel} from '../blockers-panel';

interface Dictionaries {
  pileGrades: {id: string; name: string}[];
  drillingTypes: {id: string; name: string}[];
  downtimeReasons: {id: string; name: string}[];
}

type Tab = 'PILES' | 'DRILLING' | 'DOWNTIME';

const TABS: {value: Tab; label: string}[] = [
  {value: 'PILES', label: 'Сваи'},
  {value: 'DRILLING', label: 'Бурение'},
  {value: 'DOWNTIME', label: 'Простой'},
];

/**
 * Рабочий экран: учёт выработки по ходу смены.
 *
 * ПОЧЕМУ ЗАПИСЬ ПО ХОДУ, А НЕ ОТЧЁТ В КОНЦЕ. Отчёт, который заполняют в 19:00
 * по памяти, — это оценка. Свая, отмеченная сразу, помнит время; простой,
 * отмеченный сразу, помнит причину. Разница видна на первом же разборе, почему
 * объект отстаёт от плана.
 */
export function WorkScreen({state, onLog, onRequestClosing, onOpenSafety, busy, error}: {
  state: OperatorMobileState;
  onLog: (entry: ProductionEntryInput) => void;
  onRequestClosing: () => void;
  onOpenSafety: (stage: 'TB_PILING' | 'TB_DRILLING') => void;
  busy: boolean;
  error: string | null;
}) {
  const [tab, setTab] = useState<Tab>('PILES');
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [count, setCount] = useState('');
  const [meters, setMeters] = useState('');
  const [hours, setHours] = useState('');
  const [comment, setComment] = useState('');
  const [reference, setReference] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/dictionary/all', {credentials: 'same-origin'})
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: Dictionaries | null) => {
        if (!cancelled && payload) setDictionaries(payload);
      })
      .catch(() => undefined);
    return () => {cancelled = true;};
  }, []);

  // Смена вкладки очищает форму: марка сваи не имеет смысла в простое, а
  // «5» из поля свай, оставшееся в поле часов, — это ошибочный отчёт. Сброс
  // живёт в обработчике, а не в эффекте: эффект на смену вкладки дал бы лишний
  // цикл отрисовки и делал бы вид, что данные приходят извне.
  const switchTab = (next: Tab) => {
    setTab(next);
    setReference('');
    setCount('');
    setMeters('');
    setHours('');
    setComment('');
  };

  const safetyDone = (stage: 'TB_PILING' | 'TB_DRILLING') =>
    state.checklists.find((checklist) => checklist.stage === stage)?.done ?? false;

  const needsSafety = (tab === 'PILES' && !safetyDone('TB_PILING'))
    || (tab === 'DRILLING' && !safetyDone('TB_DRILLING'));

  const options = tab === 'PILES'
    ? dictionaries?.pileGrades ?? []
    : tab === 'DRILLING'
      ? dictionaries?.drillingTypes ?? []
      : dictionaries?.downtimeReasons ?? [];

  const ready = Boolean(reference) && (
    tab === 'PILES' ? Number(count) > 0
      : tab === 'DRILLING' ? Number(count) > 0 && Number(meters) > 0
        : Number(hours) > 0
  );

  const submit = () => {
    if (tab === 'PILES') {
      onLog({kind: 'PILES', pileGradeId: reference, count: Number(count), comment: comment || undefined});
    } else if (tab === 'DRILLING') {
      onLog({kind: 'DRILLING', typeId: reference, count: Number(count), meters: Number(meters)});
    } else {
      onLog({kind: 'DOWNTIME', reasonId: reference, hours: Number(hours), comment: comment || undefined});
    }
    setCount('');
    setMeters('');
    setHours('');
    setComment('');
  };

  return (
    <Screen
      title="Работа"
      subtitle={shiftSubtitle(state)}
      footer={(
        <div className="space-y-2">
          <BigButton onClick={submit} disabled={!ready || busy || needsSafety}>
            {busy ? 'Записываем…' : 'Записать'}
          </BigButton>
          <BigButton tone="ghost" onClick={onRequestClosing}>Сдать смену</BigButton>
        </div>
      )}
    >
      <BlockersPanel blockers={state.blockers} />

      <Panel tone={state.workAllowed ? 'ok' : 'warning'}>
        <p className="text-xl font-bold">
          {state.workAllowed ? 'Работа разрешена' : 'Работа ограничена'}
        </p>
        <div className="mt-2">
          <Fact label="Свай за смену" value={state.production.piles} hint="шт" />
          <Fact label="Бурение" value={state.production.drillingMeters.toFixed(1)} hint="м" />
          <Fact label="Простой" value={state.production.downtimeHours.toFixed(1)} hint="ч" />
          {state.weather?.windMs !== null && state.weather ? (
            <Fact label="Ветер" value={state.weather.windMs} hint="м/с" />
          ) : null}
        </div>
      </Panel>

      <div className="flex gap-2">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => switchTab(option.value)}
            className={`min-h-[56px] flex-1 rounded-xl border-2 text-lg font-bold ${
              tab === option.value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {needsSafety ? (
        <Panel tone="warning">
          <h2 className="text-xl font-bold">Нужен чек-лист ТБ</h2>
          <p className="mt-1 text-base">
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
            <span className="text-base font-semibold">
              {tab === 'PILES' ? 'Марка сваи' : tab === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
            </span>
            <select
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              className="mt-1 h-[60px] w-full rounded-2xl border-2 border-neutral-900 px-3 text-lg font-semibold"
            >
              <option value="">Выберите…</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          </label>

          {tab !== 'DOWNTIME' ? (
            <NumberField label={tab === 'PILES' ? 'Свай, шт' : 'Скважин, шт'} value={count} onChange={setCount} />
          ) : null}
          {tab === 'DRILLING' ? (
            <NumberField label="Метров всего" value={meters} onChange={setMeters} decimal />
          ) : null}
          {tab === 'DOWNTIME' ? (
            <NumberField label="Длительность, часов" value={hours} onChange={setHours} decimal />
          ) : null}
          {tab !== 'DRILLING' ? (
            <label className="block">
              <span className="text-base font-semibold">Комментарий</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border-2 border-neutral-300 p-3 text-base"
              />
            </label>
          ) : null}
        </div>
      )}

      <ErrorNote message={error} />
    </Screen>
  );
}

/**
 * Подпись экрана всегда называет производственные сутки смены. Незакрытая
 * вчерашняя смена продолжается сегодня, и без даты оператор не поймёт, почему
 * выработка идёт не туда, куда он ждёт.
 */
function shiftSubtitle(state: OperatorMobileState): string {
  const parts = [state.assignment?.equipmentName, state.assignment?.siteName].filter(Boolean);
  if (state.shift) {
    parts.push(`смена за ${new Date(state.shift.productionDate).toLocaleDateString('ru-RU')}`);
  }
  return parts.join(' · ');
}

function NumberField({label, value, onChange, decimal}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  decimal?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-base font-semibold">{label}</span>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-[60px] w-full rounded-2xl border-2 border-neutral-900 px-4 text-2xl font-bold tabular-nums"
      />
    </label>
  );
}
