'use client';

import type {ReactNode} from 'react';
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
 * закрытия сервер отвергал их с 409 «Смена уже закрыта» — выработка гибла молча.
 * Здесь число неотправленных записей показано, кнопка отправки рядом, а закрытие
 * держится с видимой причиной.
 *
 * ПОЧЕМУ ПЕРЕДАЧИ СМЕНЫ НЕТ. У «Ориона» сменщиков нет: установку утром примет
 * тот же машинист, а закрытие сразу отправляет отчёт диспетчеру.
 *
 * ПОЧЕМУ БЫВАЕТ «ЧЕК-ЛИСТА НЕТ». Сервер отдаёт чек-лист осмотра после работы не
 * всегда: его состав зависит от условий. Пока экран молча звал «перейти к
 * осмотру», а открывать было нечего, машинист попадал в тупик (находка №8
 * ревью). Теперь про это сказано прямо и рядом рабочая кнопка «Обновить».
 */
export function ReportSendScreen({
  state, busy, error, tabs, unsentCount, closeNote, onCloseNoteChange, noteLocked = false, storageOk = true,
  onOpenService, onFlushQueued, onReload, onClose,
}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  tabs?: ReactNode;
  /** Сколько записей лежит на устройстве и ещё не ушло. `-1` — проверить не удалось. */
  unsentCount: number;
  closeNote: string;
  onCloseNoteChange: (value: string) => void;
  /**
   * Заметка закрыта только на время самой отправки `close-shift`. Пока идёт
   * подготовка (flush очереди), её можно менять: в команду уйдёт актуальный
   * текст, прочитанный в момент отправки (ревью №4, B5).
   */
  noteLocked?: boolean;
  /** Доступно ли хранилище черновиков — от этого зависит честная подсказка. */
  storageOk?: boolean;
  onOpenService: () => void;
  onFlushQueued: () => void;
  onReload: () => void;
  onClose: (comment: string) => void;
}) {
  const service = state.checklists.find((checklist) => checklist.stage === 'EO_AFTER');
  const serviceMissing = service === undefined;
  const serviceDone = service?.done ?? false;
  const queueUnknown = unsentCount < 0;
  const blocked = serviceMissing || !serviceDone || unsentCount !== 0;

  const closeReason = queueUnknown
    ? 'Не удалось проверить очередь на устройстве. Обновите экран — закрывать смену вслепую нельзя.'
    : serviceMissing
      ? 'Сервер не отдал чек-лист осмотра после работы. Обновите экран; если он не появится — смену закрывает диспетчер.'
      : !serviceDone
        ? 'Пока не выполнен осмотр и обслуживание после работы, смену закрыть нельзя.'
        : unsentCount > 0
          ? `На устройстве ${unsentCount} неотправленных записей. Сначала отправьте их — иначе выработка не попадёт в отчёт.`
          : undefined;

  const card = serviceMissing
    ? {
      title: 'Чек-лист осмотра после работы не получен',
      hint: 'Сервер не отдал список. Нажмите «Обновить»: если список не появится, закрыть смену сможет диспетчер — работа не пропадёт.',
      actionLabel: 'Обновить',
      onAction: onReload,
    }
    : !serviceDone
      ? {
        title: 'Осмотр и обслуживание после работы',
        hint: 'Пока машина не осмотрена и не обслужена, смену закрыть нельзя: оставленная без осмотра машина утром станет проблемой следующего.',
        actionLabel: 'Выполнить осмотр после работы',
        onAction: onOpenService,
      }
      : unsentCount > 0
        ? {
          title: `Отправьте записи с телефона: ${unsentCount}`,
          hint: 'Записи сохранены на устройстве. Нажмите «Отправить записи с телефона» — как только связь появится, они уйдут.',
          actionLabel: 'Отправить записи с телефона',
          onAction: onFlushQueued,
        }
        : queueUnknown
          ? {
            title: 'Очередь на устройстве не прочитана',
            hint: 'Проверить очередь не удалось — это не то же самое, что «пусто». Обновите экран и повторите.',
            actionLabel: 'Обновить',
            onAction: onReload,
          }
          : {
            title: 'Проверьте итоги и закройте смену',
            hint: 'Итоги ниже. Если всё верно — закройте смену: отчёт уйдёт диспетчеру.',
            actionLabel: WORDS.closeShift,
            onAction: () => onClose(closeNote),
          };

  return (
    <Screen
      title="Отчёт и отправка"
      subtitle={state.assignment?.equipmentName}
      tabs={tabs}
      footer={(
        <ActionButton
          label={busy ? 'Отправляем…' : WORDS.closeShift}
          hint={unsentCount > 0 ? `Не отправлено на сервер: ${unsentCount}` : 'Отчёт уйдёт диспетчеру сразу'}
          onClick={() => onClose(closeNote)}
          disabled={busy || blocked}
          reason={closeReason}
          tone={blocked ? 'neutral' : 'primary'}
        />
      )}
    >
      <NextActionCard {...card} disabled={busy} />

      <WarningsPanel warnings={state.warnings} />

      {serviceMissing ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">Осмотр после работы недоступен</PanelTitle>
          <p className="mt-1 text-sm">
            Сервер не прислал чек-лист «{WORDS.eoAfter}». Обычно он приходит вместе со сменой.
            Нажмите «Обновить»; если список не появится, оставьте смену открытой и скажите диспетчеру —
            закрывать её вслепую нельзя.
          </p>
          <div className="mt-3">
            <ActionButton label="Обновить" tone="ghost" onClick={onReload} disabled={busy} />
          </div>
        </Panel>
      ) : (
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
      )}

      <Panel tone={unsentCount !== 0 ? 'warning' : 'plain'}>
        <PanelTitle tone={unsentCount !== 0 ? 'warning' : 'plain'}>
          {queueUnknown ? 'Очередь на устройстве не прочитана' : `Неотправленные записи: ${unsentCount}`}
        </PanelTitle>
        <p className="mt-1 text-sm">
          {queueUnknown
            ? 'Проверить очередь не удалось. Это не то же самое, что «пусто»: сначала обновите экран.'
            : unsentCount > 0
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
          <StageTitle hint="Что оставить себе на завтра: незаконченная работа, что подготовить, на что обратить внимание. Заметка сохраняется при переходах.">
            Заметка на завтра
          </StageTitle>
          <textarea
            value={closeNote}
            disabled={noteLocked}
            onChange={(event) => onCloseNoteChange(event.target.value)}
            rows={3}
            placeholder="Например: осталось 4 сваи у оси Б, вывезти грунт"
            className="w-full rounded-md border bg-card p-3 text-sm shadow-xs"
          />
          {!storageOk ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Черновик не сохранится при перезагрузке страницы: память браузера недоступна.
            </p>
          ) : null}
        </div>
      ) : null}

      {blocked ? <ReasonNote>{closeReason}</ReasonNote> : null}

      <ErrorNote message={error} />
    </Screen>
  );
}
