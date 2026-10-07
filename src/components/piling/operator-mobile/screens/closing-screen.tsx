'use client';

import {useState, type ReactNode} from 'react';
import {formatDowntimeHoursOnly} from '@/lib/downtime-hours';
import {pluralizeRu} from '@/lib/format';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {formatDateTimeInTimezone} from '@/lib/timezone';
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
 *
 * ПОЧЕМУ НЕЛЬЗЯ ЗАКРЫТЬ С НЕОТПРАВЛЕННЫМИ ЗАПИСЯМИ. Сервер после закрытия
 * отвергает всё, что пришло в смену позже («Смена уже закрыта»): сваи,
 * лежавшие на телефоне без связи, в отчёт бы уже не попали (аудит R43 №1).
 *
 * ПОЧЕМУ ЖДУЩИЕ И ОТВЕРГНУТЫЕ СЧИТАЮТСЯ РАЗДЕЛЬНО. Отправка пропускает
 * записи с `FAILED` — сервер отказал по существу, и повторять то же самое
 * бессмысленно. Общий счётчик неотправленного прятал за собой закрытие смены,
 * а кнопка «Отправить записи с телефона» для таких записей ничего не делала:
 * смена оставалась незакрываемой навсегда, и выход был только в плашке вверху,
 * о которой машинист не знал (аудит R76, F-V1-CLOSE-FAILED). Ждёт отправки —
 * записи `PENDING`, у них один выход: отправить. Отклонённые — решение
 * человека: повторить или убрать, поэтому кнопка зовёт к разбору, а закрытие
 * смены не прячется навсегда — правило держится только на `PENDING`.
 */
export function ClosingScreen({state, onOpenService, onClose, busy, error, errorDetails, tabs, pending = 0, failed = 0, onSendNow, onRetryFailed}: {
  state: OperatorMobileState;
  onOpenService: () => void;
  onClose: (comment: string) => void;
  busy: boolean;
  error: string | null;
  /** Подробности отказа (аудит R76, находка 10). */
  errorDetails?: string[];
  /** Нижние вкладки. Рисует оболочка — экран лишь отдаёт их в Screen. */
  tabs?: ReactNode;
  /** Сколько записей этого машиниста ещё ждут отправки (`PENDING`). */
  pending?: number;
  /** Сколько записей сервер отклонил по существу (`FAILED`). */
  failed?: number;
  /** Отправить ждущие записи сейчас. */
  onSendNow?: () => void;
  /** Вернуть отклонённые в отправку — решение человека. */
  onRetryFailed?: () => void;
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
        !serviceDone
          ? <BigButton onClick={onOpenService}>Выполнить ЕО после работы</BigButton>
          : pending > 0
            ? <BigButton onClick={onSendNow}>Отправить записи с телефона</BigButton>
            : (
              <>
                {failed > 0 ? (
                  <BigButton tone="ghost" onClick={onRetryFailed}>Повторить отклонённые</BigButton>
                ) : null}
                <BigButton onClick={() => onClose(comment)} disabled={busy}>
                  {busy ? 'Отправляем…' : 'Закрыть смену и отправить отчёт'}
                </BigButton>
              </>
            )
      )}
    >
      <WarningsPanel warnings={state.warnings} />

      {pending > 0 ? (
        <Panel tone="warning">
          <PanelTitle tone="warning">
            На телефоне {pluralizeRu(pending, ['ждёт', 'ждут', 'ждут'])} отправки: {pending}
          </PanelTitle>
          <p className="mt-1 text-sm">
            Смену можно закрыть, когда эти записи уйдут на сервер. Если отправка не проходит —
            причина видна в строке с записями вверху экрана.
          </p>
        </Panel>
      ) : null}

      {failed > 0 ? (
        <Panel tone="danger">
          <PanelTitle tone="danger">
            Сервер не принял {failed} {pluralizeRu(failed, ['запись', 'записи', 'записей'])}
          </PanelTitle>
          <p className="mt-1 text-sm">
            Причина — в списке вверху: исправьте и повторите или удалите запись.
          </p>
          {pending === 0 ? (
            <p className="mt-1 text-sm">
              Такие записи в отчёт не попадут, но закрыть смену можно — решение за вами.
            </p>
          ) : null}
        </Panel>
      ) : null}

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
          <Fact label="Простой" value={formatDowntimeHoursOnly(state.production.downtimeHours)} />
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

      <ErrorNote message={error} details={errorDetails} />
    </Screen>
  );
}

/**
 * Экран после закрытия: отчёт отправлен, действий больше нет.
 *
 * ПОЧЕМУ ЗДЕСЬ ЕСТЬ ОТКАЗ. Смену могли закрыть на другом устройстве, пока
 * экран оставался в фазе работы: машинист вводит сваю, сервер отвечает 409
 * «Смена уже закрыта», рабочее место перечитывает состояние и переходит в эту
 * фазу. Без строки отказа итог смены на экране отличался бы от введённого, и
 * человек не понимал бы, почему его свай здесь нет (аудит R82, находка 5).
 * Запись при этом остаётся видимой плашкой очереди — её рисует оболочка.
 */
export function ClosedScreen({state, tabs, error = null, errorDetails}: {
  state: OperatorMobileState;
  tabs?: ReactNode;
  error?: string | null;
  /** Подробности отказа (аудит R82, находка 5). */
  errorDetails?: string[];
}) {
  const receiptTime = state.receipt?.submittedAt ?? state.receipt?.closedAt ?? null;
  const reportAccepted = Boolean(state.receipt?.submittedAt);

  return (
    <Screen title="Смена закрыта" subtitle={state.assignment?.equipmentName} tabs={tabs}>
      <ErrorNote message={error} details={errorDetails} />

      <Panel tone={reportAccepted ? 'ok' : 'warning'}>
        <PanelTitle tone={reportAccepted ? 'ok' : 'warning'}>
          {reportAccepted ? 'Принято сервером' : state.receipt ? 'Смена закрыта сервером' : 'Смена закрыта'}
        </PanelTitle>
        <p className="mt-1 text-sm">
          {reportAccepted
            ? 'Отчёт отправлен диспетчеру. Можно закрывать приложение.'
            : state.receipt
              ? 'Номер отчёта сформирован, подтверждение отправки пока не получено.'
              : 'Номер отчёта пока недоступен'}
        </p>
        {state.receipt ? (
          <dl className="mt-3 grid gap-2 rounded-lg border border-success/25 bg-card/70 p-3 text-sm">
            <div className="grid gap-1">
              <dt className="text-2xs text-muted-foreground">Номер отчёта</dt>
              <dd className="break-all font-semibold tabular-nums">{state.receipt.reportId}</dd>
            </div>
            {receiptTime ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Принят</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {formatDateTimeInTimezone(receiptTime, state.receipt.timezone)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
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
        <Fact label="Простой" value={formatDowntimeHoursOnly(state.production.downtimeHours)} />
      </Panel>
    </Screen>
  );
}
