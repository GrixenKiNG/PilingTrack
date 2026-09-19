'use client';

import type {ReactNode} from 'react';
import {formatDowntimeHours} from '@/modules/reports/domain/downtime-hours';

import {useState} from 'react';
import {CONDITION_LABELS, type OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {SELECTABLE_SHIFT_TYPES} from '@/modules/reports/domain/shift-types';
import {BigButton, ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '../ui';
import {WarningsPanel} from '../warnings-panel';

/**
 * Приём установки: объект, машина, состояние парка, погода.
 *
 * ПОЧЕМУ ЗДЕСЬ СВОДКА ПО ОБЪЕКТУ, А НЕ ПО МАШИНЕ. План ведётся по объекту, и
 * первое, что оператор хочет знать утром, — сколько на нём уже забито и сколько
 * осталось. Наработка машины важна механику, а не машинисту в семь утра.
 *
 * ПОЧЕМУ НЕТ ВВОДА МОТОЧАСОВ. Их снимают при пуске, в ЕО перед работой. Два
 * ввода подряд про одно и то же заполняют не глядя.
 */
export function AdmissionScreen({state, tabs, onAccept, onSelectEquipment, busy, error}: {
  state: OperatorMobileState;
  /** Нижние вкладки: на приёме они уже доступны — см. `operator-mobile-app`. */
  tabs?: ReactNode;
  onAccept: (input: {equipmentId: string; shiftType: 'DAY' | 'NIGHT'}) => void;
  /**
   * Выбор машины поднят в оболочку, потому что от него зависит не только
   * подсветка кнопки. Пока выбор жил здесь, нажатие на вторую установку
   * перекрашивало плитку, а объект, наработка и объём на экране оставались от
   * первой: оператор принимал одну машину, глядя на цифры другой.
   */
  onSelectEquipment: (equipmentId: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const assignment = state.assignment;
  const [shiftType, setShiftType] = useState<'DAY' | 'NIGHT'>('DAY');

  if (!assignment) {
    return (
      <Screen title="Приём установки" tabs={tabs}>
        <WarningsPanel warnings={state.warnings} />
        <Panel>
          <p className="text-sm text-muted-foreground">
            За вами не закреплена ни одна установка. Работать не на чем.
          </p>
        </Panel>
      </Screen>
    );
  }

  const maintenance = assignment.maintenance;
  const maintenanceValue = maintenance.daysLeft === null
    ? '—'
    : maintenance.daysLeft < 0 ? `просрочено на ${Math.abs(maintenance.daysLeft)}` : maintenance.daysLeft;

  return (
    <Screen
      title="Приём установки"
      tabs={tabs}
      subtitle={`${assignment.siteName} · ${new Date().toLocaleDateString('ru-RU')}`}
      footer={(
        <BigButton
          onClick={() => onAccept({equipmentId: assignment.equipmentId, shiftType})}
          disabled={busy}
        >
          {busy ? 'Открываем смену…' : 'Принять и открыть смену'}
        </BigButton>
      )}
    >
      <WarningsPanel warnings={state.warnings} />

      {state.options.length > 1 ? (
        <div className="space-y-2">
          <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
            На какой машине работаете
          </h2>
          {state.options.map((option) => (
            <button
              key={option.crewId}
              type="button"
              onClick={() => onSelectEquipment(option.equipmentId)}
              className={cn(
                'min-h-12 w-full rounded-lg border bg-card px-4 py-2 text-left shadow-xs transition-colors',
                assignment.equipmentId === option.equipmentId
                  ? 'border-signal bg-signal/10'
                  : 'hover:bg-secondary',
              )}
            >
              <span className="block text-sm font-semibold">{option.equipmentName}</span>
              <span className="block text-2xs text-muted-foreground">{option.siteName}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Panel>
        <PanelTitle>{assignment.equipmentName}</PanelTitle>
        <p className="text-2xs text-muted-foreground">
          {assignment.equipmentModel || 'модель не указана'}
        </p>
        <div className="mt-3">
          <Fact label="Объект" value={assignment.siteName} />
          <VolumeFact
            label="Свай забито ранее"
            count={assignment.sitePiles.count}
            meters={assignment.sitePiles.meters}
          />
          <VolumeFact
            label="Лидерное бурение"
            count={assignment.siteDrilling.count}
            meters={assignment.siteDrilling.meters}
          />
          <Fact label="Простой" value={formatDowntimeHours(assignment.siteDowntimeHours)} />
          <Fact
            label="Топливо"
            value={assignment.fuelPercent === null ? '—' : assignment.fuelPercent}
            unit={assignment.fuelPercent === null ? undefined : '%'}
          />
          <Fact label="Следующее ТО через" value={maintenanceValue} unit="дней" />
          {assignment.assistants.length > 0 ? (
            <Fact label="Помощник" value={assignment.assistants.join(', ')} />
          ) : null}
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">
          Свай, бурение и простой — накопительно по объекту. Топливо — остаток на конец предыдущей
          смены этой машины.
        </p>
      </Panel>

      {/* Погода — строкой, а не двумя крупными числами в отдельной карточке.
          Температура и ветер здесь нужны как условие допуска к работам, а не
          как сводка: карточка на сто точек ради двух чисел отодвигала кнопку
          приёмки за край экрана. */}
      <Panel tone={state.weather ? 'plain' : 'warning'}>
        {state.weather ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Погода на площадке
              </span>
              <span className="text-sm font-bold tabular-nums">
                {state.weather.temperatureC !== null ? `${state.weather.temperatureC}°` : '—'}
                {' · ветер '}
                {state.weather.windMs !== null ? state.weather.windMs : '—'}
                {' м/с'}
              </span>
            </div>
            {state.conditions.length > 0 ? (
              <p className="mt-1 text-2xs text-muted-foreground">
                {state.conditions.map((condition) => CONDITION_LABELS[condition]).join(', ')}.
                В чек-листы добавлены сезонные пункты.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <PanelTitle>Погода на площадке</PanelTitle>
            <p className="mt-1 text-sm">
              Погода недоступна: нет координат либо сервис молчит. Сезонные пункты чек-листов
              не добавлены — оцените условия сами.
            </p>
          </>
        )}
      </Panel>

      {/*
        Выбор смены показываем, только когда их больше одной. Кнопка с
        единственным вариантом ничего не решает, а место на телефоне занимает.
        Вернуть ночную — в SELECTABLE_SHIFT_TYPES.
      */}
      {SELECTABLE_SHIFT_TYPES.length > 1 ? (
        <div className="space-y-2">
          <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Смена</h2>
          <div className="flex gap-2 rounded-lg bg-secondary p-1">
            {SELECTABLE_SHIFT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setShiftType(type)}
                className={cn(
                  'min-h-11 flex-1 rounded-md text-sm font-medium transition-colors',
                  shiftType === type ? 'border bg-card font-semibold shadow-xs' : 'text-muted-foreground',
                )}
              >
                {type === 'DAY' ? 'Дневная' : 'Ночная'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ErrorNote message={error} />
    </Screen>
  );
}
