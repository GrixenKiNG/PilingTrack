'use client';

import {useState, type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {BigButton, ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '../ui';
import {WarningsPanel} from '../warnings-panel';

/**
 * Закрытие смены.
 *
 * ПОЧЕМУ НЕТ ПЕРЕДАЧИ СМЕНЫ. Бригада работает в одну смену, и утром установку
 * примет тот же машинист. Принимать не у кого: закрытие сразу отправляет отчёт
 * диспетчеру, а «что осталось» оператор пишет сам себе на завтра.
 *
 * ПОЧЕМУ ЕО ПОСЛЕ РАБОТЫ — УСЛОВИЕ, А НЕ ПОЖЕЛАНИЕ. Машина, оставленная без
 * осмотра, утром становится проблемой того, кто на неё сядет: примёрзшие
 * гусеницы, невидимая на горячем ночью течь, трещина, которую никто не искал.
 */
export function ClosingScreen({state, onOpenService, onClose, busy, error, tabs}: {
  state: OperatorMobileState;
  onOpenService: () => void;
  onClose: (comment: string) => void;
  busy: boolean;
  error: string | null;
  /** Нижние вкладки. Рисует оболочка — экран лишь отдаёт их в Screen. */
  tabs?: ReactNode;
}) {
  const [comment, setComment] = useState('');
  const service = state.checklists.find((checklist) => checklist.stage === 'EO_AFTER');
  const serviceDone = service?.done ?? false;

  return (
    <Screen
      tabs={tabs}
      title="Закрытие смены"
      subtitle={state.assignment?.equipmentName}
      footer={(
        serviceDone
          ? (
            <BigButton onClick={() => onClose(comment)} disabled={busy}>
              {busy ? 'Отправляем…' : 'Закрыть смену и отправить отчёт'}
            </BigButton>
          )
          : <BigButton onClick={onOpenService}>Выполнить ЕО после работы</BigButton>
      )}
    >
      <WarningsPanel warnings={state.warnings} />

      <Panel tone={serviceDone ? 'ok' : 'warning'}>
        <PanelTitle tone={serviceDone ? 'ok' : 'warning'}>
          {serviceDone ? 'Послесменное обслуживание выполнено' : 'Сначала послесменное обслуживание'}
        </PanelTitle>
        <p className="mt-1 text-sm">
          {serviceDone
            ? 'Осталось записать итог смены и отправить отчёт диспетчеру.'
            : 'Пока машина не осмотрена и не обслужена, смену закрыть нельзя.'}
        </p>
      </Panel>

      <Panel>
        <PanelTitle>Итог смены</PanelTitle>
        <div className="mt-2">
          <VolumeFact
            label="Свай забито"
            count={state.production.piles.count}
            meters={state.production.piles.meters}
          />
          <VolumeFact
            label="Лидерное бурение"
            count={state.production.drilling.count}
            meters={state.production.drilling.meters}
          />
          <Fact label="Простой" value={state.production.downtimeHours.toFixed(1)} unit="ч" />
        </div>
        {/*
          Остатка топлива здесь намеренно нет. Поле `fuelPercent` — это остаток
          ПРЕДЫДУЩЕЙ смены: текущий попадает в отчёт только при закрытии.
          Строка «Топливо на конец» с прошлым числом читалась бы как итог этой
          смены и врала бы ровно в том месте, ради которого её и заводили.
        */}
      </Panel>

      {serviceDone ? (
        <label className="block">
          <span className="text-2xs font-medium text-muted-foreground">
            Что оставить себе на завтра
          </span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={4}
            placeholder="Незаконченная работа, что подготовить, на что обратить внимание"
            className="mt-1 w-full rounded-md border bg-card p-3 text-sm shadow-xs"
          />
        </label>
      ) : null}

      <ErrorNote message={error} />
    </Screen>
  );
}

/** Экран после закрытия: отчёт отправлен, действий больше нет. */
export function ClosedScreen({state}: {state: OperatorMobileState}) {
  return (
    <Screen title="Смена закрыта" subtitle={state.assignment?.equipmentName}>
      <Panel tone="ok">
        <PanelTitle tone="ok">Отчёт отправлен диспетчеру</PanelTitle>
        <p className="mt-1 text-sm">Спасибо. Можно закрывать приложение.</p>
      </Panel>
      <Panel>
        <VolumeFact
          label="Свай забито"
          count={state.production.piles.count}
          meters={state.production.piles.meters}
        />
        <VolumeFact
          label="Лидерное бурение"
          count={state.production.drilling.count}
          meters={state.production.drilling.meters}
        />
        <Fact label="Простой" value={state.production.downtimeHours.toFixed(1)} unit="ч" />
      </Panel>
    </Screen>
  );
}
