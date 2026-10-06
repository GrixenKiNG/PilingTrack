'use client';

import {useState} from 'react';
import {CONDITION_LABELS, type OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {SHIFT_TYPES, type ShiftTypeValue} from '@/modules/reports/domain/shift-types';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '@/components/piling/operator-mobile/ui';
import {WarningsPanel} from '@/components/piling/operator-mobile/warnings-panel';
import {ActionButton, ChoiceButton, StageTitle} from './parts';
import {SHIFT_TYPE_LABELS} from './words';

/**
 * Приём установки — шаг, который открывает смену.
 *
 * ПОЧЕМУ ПРИЁМКА ОТДЕЛЬНОЙ КНОПКОЙ. В v2 смена открывалась тапом по строке
 * установки: новичок тапал «посмотреть» и открывал смену на чужой машине
 * (находка P0 №19). Здесь строка только ВЫБИРАЕТ установку, а смену открывает
 * кнопка «Принять установку» под выбранной машиной.
 *
 * ПОЧЕМУ ТИП СМЕНЫ ВЫБИРАЕТ ЧЕЛОВЕК. В v2 день и ночь определяли часы телефона
 * и нигде не показывали: смена, начатая в 19:30, записывалась дневной
 * (находка P0 №20). Тип выбирается явно и до приёмки; по часам телефона не
 * угадывается никогда.
 *
 * ПОЧЕМУ ПРИЁМКА ЖДЁТ ЗАГРУЗКИ ВЫБРАННОЙ МАШИНЫ. Состояние с сервера приходит
 * по конкретной установке. Пока ответ на смену выбора не пришёл, на экране
 * цифры прежней машины: принять по такой карточке значит открыть смену не на
 * той установке, которую человек выбрал (находка №4 ревью).
 */
export function ShiftStartScreen({
  state, busy, loading, error, onAccept, onSelectEquipment, selectedEquipmentId, onReload,
}: {
  state: OperatorMobileState;
  busy: boolean;
  /** Идёт чтение состояния (первое или после смены установки). */
  loading: boolean;
  error: string | null;
  onAccept: (input: {equipmentId: string; shiftType: 'DAY' | 'NIGHT'}) => void;
  onSelectEquipment: (equipmentId: string) => void;
  selectedEquipmentId: string | null;
  onReload: () => void;
}) {
  const assignment = state.assignment;
  /**
   * Тип смены стартует ПУСТЫМ. Подставлять дневную по умолчанию значило бы
   * повторить ошибку предвыбора: человек подписывает то, чего не выбирал.
   */
  const [shiftType, setShiftType] = useState<ShiftTypeValue | null>(null);
  /**
   * Что считаем выбором человека.
   *
   * ПОЧЕМУ НЕ ПРОСТО ПЕРВУЮ УСТАНОВКУ СПИСКА. Сервер отдаёт выбранную установку
   * заранее, и строка сразу выглядела выбранной: при нескольких машинах человек
   * мог принять ту, которую сам не выбирал (находка Д3 аудита). Когда машин
   * больше одной, приёмка ждёт явного касания; когда одна — выбора нет, и
   * серверный вариант и есть единственный (иначе нечего выбирать).
   */
  const autoEquipmentId = state.options.length <= 1
    ? (state.options[0]?.equipmentId ?? assignment?.equipmentId ?? null)
    : null;
  const activeEquipmentId = selectedEquipmentId ?? autoEquipmentId;
  // Какая установка ПОКАЗАНА сейчас. Ответ на прежний выбор — это не она.
  const shownEquipmentId = assignment?.equipmentId ?? null;
  const shownIsChosen = Boolean(activeEquipmentId) && shownEquipmentId === activeEquipmentId;

  if (state.options.length === 0 && !assignment) {
    return (
      <Screen
        title="Принять установку"
        footer={<ActionButton label="Обновить" tone="ghost" onClick={onReload} />}
      >
        <Panel tone="warning">
          <PanelTitle tone="warning">За вами не закреплена ни одна установка</PanelTitle>
          <p className="mt-1 text-sm">
            Работать не на чем. Обратитесь к диспетчеру: он закрепит за вами установку и бригаду.
            После этого нажмите «Обновить» — экран перечитает данные.
          </p>
        </Panel>
      </Screen>
    );
  }

  const acceptReason = shiftType === null
    ? 'Сначала выберите тип смены: дневная или ночная.'
    : !activeEquipmentId
      ? 'Сначала выберите установку.'
      : !shownIsChosen
        ? 'Показываем другую установку — дождитесь загрузки выбранной.'
        : undefined;

  return (
    <Screen
      title="Принять установку"
      subtitle={assignment ? `${assignment.siteName} · ${formatDate(state.productionDate)}` : undefined}
      footer={(
        <ActionButton
          label="Принять установку"
          hint={shiftType
            ? `Смена: ${SHIFT_TYPE_LABELS[shiftType].title.toLowerCase()}, ${SHIFT_TYPE_LABELS[shiftType].window}`
            : 'Откроет смену на выбранной машине'}
          onClick={() => {
            // В команду уходит установка, ПОКАЗАННАЯ на карточке: она совпадает
            // с выбранной только тогда, когда кнопка доступна.
            if (!shownEquipmentId || !shiftType) return;
            onAccept({equipmentId: shownEquipmentId, shiftType});
          }}
          disabled={busy || loading || acceptReason !== undefined}
          reason={acceptReason}
        />
      )}
    >
      <WarningsPanel warnings={state.warnings} />

      {loading ? (
        <p role="status" className="text-sm font-semibold text-info-strong">
          Загружаем выбранную установку…
        </p>
      ) : null}

      {state.options.length > 1 ? (
        <div className="space-y-2">
          <StageTitle>На какой установке работаете</StageTitle>
          {state.options.map((option) => (
            <ChoiceButton
              key={option.crewId}
              label={option.equipmentName}
              hint={option.siteName}
              selected={activeEquipmentId === option.equipmentId}
              onClick={() => onSelectEquipment(option.equipmentId)}
              disabled={busy || loading}
            />
          ))}
          <p className="text-sm text-muted-foreground">
            Касание строки только выбирает установку. Смена откроется после кнопки «Принять установку».
          </p>
        </div>
      ) : null}

      {assignment ? (
        <Panel>
          <PanelTitle>{assignment.equipmentName}</PanelTitle>
          <p className="text-sm text-muted-foreground">
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
            <Fact
              label={`До ${SHIFT_TO_LABEL}`}
              value={maintenanceValue(assignment.maintenance)}
            />
            {assignment.assistants.length > 0 ? (
              <Fact label="Помощник" value={assignment.assistants.join(', ')} />
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Сваи, бурение и простой — накопительно по объекту. Топливо — остаток на конец предыдущей
            смены этой машины.
          </p>
        </Panel>
      ) : null}

      <Panel tone={state.weather ? 'plain' : 'warning'}>
        {state.weather ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Погода на площадке
              </span>
              <span className="text-base font-bold tabular-nums">
                {state.weather.temperatureC !== null ? `${state.weather.temperatureC}°` : '—'}
                {' · ветер '}
                {state.weather.windMs !== null ? state.weather.windMs : '—'}
                {' м/с'}
              </span>
            </div>
            {state.conditions.length > 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {state.conditions.map((condition) => CONDITION_LABELS[condition]).join(', ')}.
                В чек-листы добавлены сезонные пункты.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <PanelTitle>Погода на площадке</PanelTitle>
            <p className="mt-1 text-sm">
              Погода недоступна: нет координат либо сервис молчит. Сезонные пункты чек-листов не
              добавлены — оцените условия сами.
            </p>
          </>
        )}
      </Panel>

      {/* Тип смены — всегда видно, всегда выбор человека. Оба варианта показаны
          полностью: и день, и ночь, вместе с окнами. */}
      <div className="space-y-2">
        <StageTitle hint="Смены: дневная 07:00–19:00, ночная 19:00–07:00. Выбираете вы, а не часы телефона.">
          Смена
        </StageTitle>
        {SHIFT_TYPES.map((type) => (
          <ChoiceButton
            key={type}
            label={SHIFT_TYPE_LABELS[type].title}
            hint={SHIFT_TYPE_LABELS[type].window}
            selected={shiftType === type}
            onClick={() => setShiftType(type)}
            disabled={busy}
          />
        ))}
      </div>

      <ErrorNote message={error} />
    </Screen>
  );
}

/** Полное слово у сокращения «ТО»: в аудите его не расшифровывала ни одна версия. */
const SHIFT_TO_LABEL = 'планового обслуживания (ТО)';

function maintenanceValue(maintenance: {overdue: boolean; soon: boolean; daysLeft: number | null}): string {
  if (maintenance.daysLeft === null) return '—';
  if (maintenance.daysLeft < 0) {
    return `просрочено на ${Math.abs(maintenance.daysLeft)} ${pluralDays(Math.abs(maintenance.daysLeft))}`;
  }
  return `${maintenance.daysLeft} ${pluralDays(maintenance.daysLeft)}`;
}

function pluralDays(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

function formatDate(iso: string): string {
  const parts = iso.split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : iso;
}
