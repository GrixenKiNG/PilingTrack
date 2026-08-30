'use client';

import {useState} from 'react';
import {CONDITION_LABELS, type OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {BigButton, ErrorNote, Fact, Panel, Screen} from '../ui';
import {BlockersPanel} from '../blockers-panel';

/**
 * Приём установки: объект, машина, наработка, погода.
 *
 * ПОЧЕМУ МОТОЧАСЫ ВВОДЯТСЯ РУКАМИ, А НЕ БЕРУТСЯ ИЗ ПРОШЛОЙ СМЕНЫ. Расхождение
 * между тем, что в системе, и тем, что на приборной панели, — это и есть
 * ценная информация: машину гоняли без смены, счётчик врёт, кто-то ошибся
 * вчера. Подставленное значение это расхождение прячет.
 */
export function AdmissionScreen({state, onAccept, busy, error}: {
  state: OperatorMobileState;
  onAccept: (input: {equipmentId: string; engineHours: number; shiftType: 'DAY' | 'NIGHT'}) => void;
  busy: boolean;
  error: string | null;
}) {
  const [equipmentId, setEquipmentId] = useState(state.assignment?.equipmentId ?? '');
  const [engineHours, setEngineHours] = useState('');
  const [shiftType, setShiftType] = useState<'DAY' | 'NIGHT'>('DAY');

  const assignment = state.assignment;
  const previous = assignment?.lastEngineHours ?? null;
  // Пустое поле — это не ноль: `Number('')` даёт 0, и без этой проверки
  // предупреждение «моточасы меньше предыдущего» встречало оператора ещё до
  // того, как он ввёл хоть одну цифру.
  const filled = engineHours.trim() !== '' && Number.isFinite(Number(engineHours));
  const entered = Number(engineHours);
  const belowPrevious = filled && previous !== null && entered < previous;
  const valid = filled && entered >= 0 && !belowPrevious;

  if (!assignment) {
    return (
      <Screen title="Приём установки">
        <BlockersPanel blockers={state.blockers} />
      </Screen>
    );
  }

  return (
    <Screen
      title="Приём установки"
      subtitle={`${assignment.siteName} · ${new Date().toLocaleDateString('ru-RU')}`}
      footer={(
        <BigButton
          onClick={() => onAccept({equipmentId: equipmentId || assignment.equipmentId, engineHours: entered, shiftType})}
          disabled={!valid || busy}
        >
          {busy ? 'Открываем смену…' : 'Принять и открыть смену'}
        </BigButton>
      )}
    >
      <BlockersPanel blockers={state.blockers} />

      {state.options.length > 1 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-bold">На какой машине работаете</h2>
          {state.options.map((option) => (
            <button
              key={option.crewId}
              type="button"
              onClick={() => setEquipmentId(option.equipmentId)}
              className={`min-h-[60px] w-full rounded-2xl border-2 px-4 text-left ${
                (equipmentId || assignment.equipmentId) === option.equipmentId
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white'
              }`}
            >
              <span className="block text-lg font-bold">{option.equipmentName}</span>
              <span className="block text-sm opacity-80">{option.siteName}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Panel>
        <h2 className="text-lg font-bold">{assignment.equipmentName}</h2>
        <p className="text-base text-neutral-600">{assignment.equipmentModel || 'Модель не указана'}</p>
        <div className="mt-3">
          <Fact label="Объект" value={assignment.siteName} />
          <Fact
            label="Моточасы в системе"
            value={previous ?? '—'}
            hint={previous !== null ? 'м/ч' : undefined}
          />
          <Fact label="Свай забито ранее" value={assignment.previousShiftPiles} hint="шт" />
          {assignment.assistants.length > 0 ? (
            <Fact label="Помощник" value={assignment.assistants.join(', ')} />
          ) : null}
        </div>
      </Panel>

      <Panel tone={state.weather ? 'plain' : 'warning'}>
        <h2 className="text-lg font-bold">Погода на площадке</h2>
        {state.weather ? (
          <>
            <div className="mt-2 flex gap-6">
              <div>
                <p className="text-3xl font-bold tabular-nums">
                  {state.weather.temperatureC !== null ? `${state.weather.temperatureC}°` : '—'}
                </p>
                <p className="text-sm text-neutral-600">температура</p>
              </div>
              <div>
                <p className="text-3xl font-bold tabular-nums">
                  {state.weather.windMs !== null ? state.weather.windMs : '—'}
                </p>
                <p className="text-sm text-neutral-600">ветер, м/с</p>
              </div>
            </div>
            {state.conditions.length > 0 ? (
              <p className="mt-3 text-base">
                Условия смены: {state.conditions.map((condition) => CONDITION_LABELS[condition]).join(', ')}.
                В чек-листы добавлены сезонные пункты.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-base">
            Погода недоступна: нет координат либо сервис молчит. Сезонные пункты чек-листов
            не добавлены — оцените условия сами.
          </p>
        )}
      </Panel>

      <div className="space-y-2">
        <label htmlFor="engine-hours" className="block text-lg font-bold">
          Моточасы по счётчику
        </label>
        <input
          id="engine-hours"
          type="number"
          inputMode="numeric"
          value={engineHours}
          onChange={(event) => setEngineHours(event.target.value)}
          placeholder={previous !== null ? String(previous) : '0'}
          className="h-[60px] w-full rounded-2xl border-2 border-neutral-900 px-4 text-2xl font-bold tabular-nums"
        />
        {belowPrevious ? (
          <p className="text-base font-semibold text-red-800">
            Меньше предыдущего показания ({previous}). Счётчик назад не крутится — проверьте цифру.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <span className="block text-lg font-bold">Смена</span>
        <div className="flex gap-2">
          {(['DAY', 'NIGHT'] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setShiftType(type)}
              className={`min-h-[60px] flex-1 rounded-2xl border-2 text-lg font-bold ${
                shiftType === type ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300'
              }`}
            >
              {type === 'DAY' ? 'Дневная' : 'Ночная'}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote message={error} />
    </Screen>
  );
}
