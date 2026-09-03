'use client';

import {useState, type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import type {ProductionEntryInput} from '../api';
import {BigButton, ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '../ui';
import {WarningsPanel} from '../warnings-panel';
import {EntriesList} from './entries-list';

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
/**
 * Насколько свежа погода. Сервис отдаёт время измерения, а не время
 * запроса, и разница до пятнадцати минут — обычное дело из-за кэша.
 */
function weatherAge(at: string): string {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes < 0) return 'по метеосервису';
  if (minutes < 2) return 'сейчас';
  if (minutes < 60) return `${minutes} мин назад`;
  return `${Math.round(minutes / 60)} ч назад`;
}

export function WorkScreen({state, onLog, onFinish, onOpenSafety, busy, error, tabs, onCorrect}: {
  state: OperatorMobileState;
  /** Возвращает признак удачи: по нему экран решает, чистить ли форму. */
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
  onFinish: () => void;
  onOpenSafety: (stage: 'TB_PILING' | 'TB_DRILLING') => void;
  busy: boolean;
  error: string | null;
  /** Нижние вкладки. Рисует оболочка — экран лишь отдаёт их в Screen. */
  tabs?: ReactNode;
  /** Поправка к ошибочной записи. Возвращает признак удачи. */
  onCorrect: (input: {
    entryId: string; kind: 'PILES' | 'DRILLING' | 'DOWNTIME'; actual: number; reason: string;
  }) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<Tab>('PILES');
  const [reference, setReference] = useState('');
  const [count, setCount] = useState('');
  const [metersPerUnit, setMetersPerUnit] = useState('');
  const [hours, setHours] = useState('');
  const [comment, setComment] = useState('');
  // Завершение работы обратного хода не имеет: смена уходит в сдачу, и
  // записать сваю после этого уже нельзя. Кнопка стоит вплотную к «Записать»,
  // и промах по ней в перчатке заканчивал смену досрочно. Второе нажатие
  // здесь — не бюрократия, а единственная защита от промаха.
  const [finishing, setFinishing] = useState(false);

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

  // Форма очищается только после того, как сервер подтвердил запись. Раньше
  // она очищалась сразу: обрыв связи стирал введённое вместе с надеждой
  // вспомнить, сколько там было свай. Марка сваи и причина простоя остаются
  // и после удачи — подряд пишут обычно одно и то же.
  const submit = async () => {
    const entry: ProductionEntryInput = tab === 'PILES'
      ? {kind: 'PILES', pileGradeId: reference, count: Number(count), comment: comment || undefined}
      : tab === 'DRILLING'
        ? {kind: 'DRILLING', typeId: reference, count: Number(count), metersPerUnit: Number(metersPerUnit)}
        : {kind: 'DOWNTIME', reasonId: reference, hours: Number(hours), comment: comment || undefined};

    const recorded = await onLog(entry);
    if (!recorded) return;

    setCount('');
    setMetersPerUnit('');
    setHours('');
    setComment('');
  };

  return (
    <Screen
      tabs={tabs}
      title="Работа"
      subtitle={[
        state.assignment?.equipmentName,
        state.assignment?.siteName,
        state.shift ? `смена за ${new Date(state.shift.productionDate).toLocaleDateString('ru-RU')}` : null,
      ].filter(Boolean).join(' · ')}
      footer={(
        <>
          {/*
            Погодный запрет гасит запись выработки, но не простоя: простой —
            это и есть то, чем оператор объясняет остановку по погоде. Сервер
            отказывает по тому же правилу, кнопка лишь избавляет от отказа
            после заполнения формы.
          */}
          <BigButton
            onClick={() => void submit()}
            disabled={!ready || busy || needsSafety || (!state.workAllowed && tab !== 'DOWNTIME')}
          >
            {busy ? 'Записываем…' : 'Записать'}
          </BigButton>
          {finishing ? (
            <div className="space-y-2 rounded-lg border border-warning bg-warning/10 p-3">
              <p className="text-sm font-semibold">
                Завершить работу? Записывать выработку после этого нельзя.
              </p>
              <p className="text-2xs text-muted-foreground">
                За смену: {state.production.piles.count} свай, {state.production.drilling.count} скважин,
                {' '}простой {state.production.downtimeHours.toFixed(1)} ч. Дальше — ЕО после работы.
              </p>
              <BigButton tone="danger" onClick={onFinish} disabled={busy}>
                Да, работа завершена
              </BigButton>
              <BigButton tone="ghost" onClick={() => setFinishing(false)}>Продолжить работу</BigButton>
            </div>
          ) : (
            <BigButton tone="ghost" onClick={() => setFinishing(true)}>Работа завершена</BigButton>
          )}
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
          {/*
            Ветер показываем вместе с тем, когда его измерили: работа
            прекращается при 15 м/с, и цифра без времени не даёт понять,
            это сейчас или полчаса назад. Сервис погоды держит ответ в кэше
            до пятнадцати минут, так что разница бывает существенной.
          */}
          {state.weather && state.weather.windMs !== null ? (
            <Fact
              label="Ветер"
              value={state.weather.windMs}
              unit={`м/с · ${weatherAge(state.weather.at)}`}
            />
          ) : (
            <Fact label="Ветер" value="нет данных" />
          )}
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

      <EntriesList entries={state.entries} busy={busy} onCorrect={onCorrect} />

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
