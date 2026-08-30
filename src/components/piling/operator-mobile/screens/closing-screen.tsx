'use client';

import {useState} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {BigButton, ErrorNote, Fact, Panel, Screen} from '../ui';

/**
 * Закрытие смены.
 *
 * ПОЧЕМУ ЕО ПОСЛЕ РАБОТЫ — УСЛОВИЕ, А НЕ ПОЖЕЛАНИЕ. Машина, оставленная без
 * осмотра, утром становится проблемой того, кто на неё сядет: примёрзшие
 * гусеницы, невидимая на горячем ночью течь, трещина, которую никто не искал.
 * Кнопка закрытия смены поэтому заперта до завершения списка.
 */
export function ClosingScreen({state, onOpenService, onClose, busy, error}: {
  state: OperatorMobileState;
  onOpenService: () => void;
  onClose: (comment: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [comment, setComment] = useState('');
  const service = state.checklists.find((checklist) => checklist.stage === 'EO_AFTER');
  const serviceDone = service?.done ?? false;

  return (
    <Screen
      title="Закрытие смены"
      subtitle={state.assignment?.equipmentName}
      footer={(
        serviceDone
          ? (
            <BigButton onClick={() => onClose(comment)} disabled={busy}>
              {busy ? 'Закрываем…' : 'Закрыть смену'}
            </BigButton>
          )
          : <BigButton onClick={onOpenService}>Выполнить ЕО после работы</BigButton>
      )}
    >
      <Panel tone={serviceDone ? 'ok' : 'warning'}>
        <h2 className="text-xl font-bold">
          {serviceDone ? 'Послесменное обслуживание выполнено' : 'Сначала послесменное обслуживание'}
        </h2>
        <p className="mt-1 text-base">
          {serviceDone
            ? 'Осталось записать итог смены и закрыть её.'
            : 'Пока машина не осмотрена и не обслужена, смену закрыть нельзя.'}
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-bold">Итог смены</h2>
        <div className="mt-2">
          <Fact label="Свай забито" value={state.production.piles} hint="шт" />
          <Fact label="Лидерное бурение" value={state.production.drillingMeters.toFixed(1)} hint="м" />
          <Fact label="Простой" value={state.production.downtimeHours.toFixed(1)} hint="ч" />
          <Fact label="Моточасы" value={state.assignment?.lastEngineHours ?? '—'} hint="м/ч" />
        </div>
      </Panel>

      {serviceDone ? (
        <label className="block">
          <span className="text-lg font-bold">Что передать следующей смене</span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            placeholder="Замечания, незаконченная работа, что подготовить"
            className="mt-1 w-full rounded-xl border-2 border-neutral-900 p-3 text-base"
          />
        </label>
      ) : null}

      <ErrorNote message={error} />
    </Screen>
  );
}

/** Экран после закрытия: смена сдана, действий больше нет. */
export function ClosedScreen({state}: {state: OperatorMobileState}) {
  return (
    <Screen title="Смена закрыта" subtitle={state.assignment?.equipmentName}>
      <Panel tone="ok">
        <p className="text-xl font-bold">Отчёт отправлен диспетчеру</p>
        <p className="mt-1 text-base">Спасибо. Можно закрывать приложение.</p>
      </Panel>
      <Panel>
        <Fact label="Свай забито" value={state.production.piles} hint="шт" />
        <Fact label="Лидерное бурение" value={state.production.drillingMeters.toFixed(1)} hint="м" />
        <Fact label="Простой" value={state.production.downtimeHours.toFixed(1)} hint="ч" />
      </Panel>
    </Screen>
  );
}
