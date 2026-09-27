'use client';

import {useState, type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {ErrorNote, Fact, Panel, PanelTitle, Screen, VolumeFact} from '@/components/piling/operator-mobile/ui';
import {WarningsPanel} from '@/components/piling/operator-mobile/warnings-panel';
import {ActionButton, NextActionCard, ReasonNote, StageTitle} from './parts';
import {WORDS} from './words';

/**
 * Отчёт и отправка — конец смены.
 *
 * ПОЧЕМУ ЗАКРЫТИЕ ЗАПРЕЩЕНО ПРИ НЕПУСТОЙ ОЧЕРЕДИ. Это критичная находка аудита
 * очереди: смену можно было закрыть, пока записи лежали на устройстве, и после
 * закрытия сервер отвергал их с 409 «Смена уже закрыта» — выработка гибла молча
 * (находка №1 в `43-offline-queue-edges.md`). Здесь число неотправленных записей
 * показано, кнопка отправки рядом, а закрытие держится с видимой причиной.
 *
 * ПОЧЕМУ ПЕРЕДАЧИ СМЕНЫ НЕТ. У «Ориона» сменщиков нет: установку утром примет
 * тот же машинист, а закрытие сразу отправляет отчёт диспетчеру (решение
 * владельца 27.09.2026, задача F-QA-005).
 */
export function ReportSendScreen({
  state, busy, error, tabs, unsentCount, onOpenService, onFlushQueued, onClose,
}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  tabs?: ReactNode;
  /** Сколько записей лежит на устройстве и ещё не ушло на сервер. */
  unsentCount: number;
  onOpenService: () => void;
  onFlushQueued: () => void;
  onClose: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');
  const service = state.checklists.find((checklist) => checklist.stage === 'EO_AFTER');
  const serviceDone = service?.done ?? false;
  const blocked = !serviceDone || unsentCount > 0;

  const closeReason = !serviceDone
    ? 'Пока не выполнен осмотр и обслуживание после работы, смену закрыть нельзя.'
    : unsentCount > 0
      ? `На устройстве ${unsentCount} неотправленных записей. Сначала отправьте их — иначе выработка не попадёт в отчёт.`
      : undefined;

  return (
    <Screen
      title="Отчёт и отправка"
      subtitle={state.assignment?.equipmentName}
      tabs={tabs}
      footer={(
        <ActionButton
          label={busy ? 'Отправляем…' : WORDS.closeShift}
          hint={unsentCount > 0 ? `Не отправлено на сервер: ${unsentCount}` : 'Отчёт уйдёт диспетчеру сразу'}
          onClick={() => onClose(comment)}
          disabled={busy || blocked}
          reason={closeReason}
          tone={blocked ? 'neutral' : 'primary'}
        />
      )}
    >
      <NextActionCard
        title={!serviceDone
          ? 'Осмотр и обслуживание после работы'
          : unsentCount > 0
            ? `Отправьте записи с телефона: ${unsentCount}`
            : 'Проверьте итоги и закройте смену'}
        hint={!serviceDone
          ? 'Пока машина не осмотрена и не обслужена, смену закрыть нельзя: оставленная без осмотра машина утром станет проблемой следующего.'
          : unsentCount > 0
            ? 'Записи сохранены на устройстве. Нажмите «Отправить записи с телефона» — как только связь появится, они уйдут.'
            : 'Итоги ниже. Если всё верно — закройте смену: отчёт уйдёт диспетчеру.'}
        actionLabel={!serviceDone
          ? 'Выполнить осмотр после работы'
          : unsentCount > 0
            ? 'Отправить записи с телефона'
            : WORDS.closeShift}
        onAction={!serviceDone
          ? onOpenService
          : unsentCount > 0
            ? onFlushQueued
            : () => onClose(comment)}
        disabled={busy}
      />

      <WarningsPanel warnings={state.warnings} />

      <Panel tone={serviceDone ? 'ok' : 'warning'}>
        <PanelTitle tone={serviceDone ? 'ok' : 'warning'}>
          {serviceDone ? `${WORDS.eoAfter}: выполнено` : `Сначала ${WORDS.eoAfter.toLowerCase()}`}
        </PanelTitle>
        <p className="mt-1 text-sm">
          {serviceDone
            ? 'Машина осмотрена и обслужена. Осталось проверить итоги и закрыть смену.'
            : 'Это осмотр и обслуживание машины после работы, а не «конец работы». Пока он не выполнен, смену закрыть нельзя.'}
        </p>
        {!serviceDone ? (
          <div className="mt-3">
            <ActionButton label="Перейти к осмотру после работы" tone="ghost" onClick={onOpenService} disabled={busy} />
          </div>
        ) : null}
      </Panel>

      {/* Очередь устройства — отдельной панелью. Это то место, где её отсутствие
          стоило выработки: человек закрывал смену, а записи оставались на
          телефоне и после закрытия уже не принимались. */}
      <Panel tone={unsentCount > 0 ? 'warning' : 'plain'}>
        <PanelTitle tone={unsentCount > 0 ? 'warning' : 'plain'}>
          Неотправленные записи: {unsentCount}
        </PanelTitle>
        <p className="mt-1 text-sm">
          {unsentCount > 0
            ? 'Эти записи ещё не на сервере. Они уйдут, когда появится связь, но смену до этого закрывать нельзя.'
            : 'Все записи отправлены на сервер. Дополнительно отправлять нечего.'}
        </p>
        {unsentCount > 0 ? (
          <div className="mt-3">
            <ActionButton label="Отправить записи с телефона" onClick={onFlushQueued} disabled={busy} />
          </div>
        ) : null}
      </Panel>

      <Panel>
        <PanelTitle>Итоги смены</PanelTitle>
        <div className="mt-2">
          <VolumeFact label="Свай забито" count={state.production.piles.count} meters={state.production.piles.meters} />
          <VolumeFact label="Лидерное бурение" count={state.production.drilling.count} meters={state.production.drilling.meters} />
          <Fact label="Простой" value={formatDowntimeHours(state.production.downtimeHours)} />
        </div>
      </Panel>

      {serviceDone ? (
        <div className="space-y-1.5">
          <StageTitle hint="Что оставить себе на завтра: незаконченная работа, что подготовить, на что обратить внимание.">
            Заметка на завтра
          </StageTitle>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            placeholder="Например: осталось 4 сваи у оси Б, вывезти грунт"
            className="w-full rounded-md border bg-card p-3 text-sm shadow-xs"
          />
        </div>
      ) : null}

      {blocked ? <ReasonNote>{closeReason}</ReasonNote> : null}

      <ErrorNote message={error} />
    </Screen>
  );
}
