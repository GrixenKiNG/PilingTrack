import { NotYet } from "./v10-screens-shift";
import { DASH, dateRu, stepIndex, type Go, tbTone, tbNote, documentsTone, STEP_ICON, STEP_SCREEN } from "./v10-shared";
import { useState } from 'react';
import { formatDowntimeHoursOnly } from '@/lib/downtime-hours';
import type { ChecklistAnswer, ChecklistStage, OperatorMobileState } from '@/modules/operator-mobile';
import {ChecklistScreen} from '../screens/checklist-screen';
import {ShiftThanks} from '../shift-thanks';
import {knownAnswers} from '../safety/known-answers';
import {admissionBlockers, admissionSteps} from '../safety/admission-steps';
import {documentsSummary} from '../safety/documents-summary';
import type {SelfSafetyView} from '@/modules/safety';
import {formatNumber} from '@/lib/format';
import { Banner, Card, Metric, Nodata, Pair, Row } from './v10-ui';

/**
 * Периодические чек-листы ТБ по виду работ.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ЭКРАН, А НЕ СТРОКА В ОБСЛУЖИВАНИИ. Ежесменные списки (ЕО,
 * осмотр, площадка) проходят каждую смену; ТБ по забивке и бурению —
 * периодические, по сроку инструкции, и между сроками их не трогают. Смешать
 * их значило бы каждое утро показывать человеку список, который он проходил
 * три месяца назад и пройдёт через три.
 *
 * ПОЧЕМУ ЭТОТ ЭКРАН ПОЯВИЛСЯ. Из обслуживания оба списка исключены намеренно,
 * а перехода к ним не было нигде. Новый оператор упирался в 409 «Подошёл срок
 * чек-листа ТБ по забивке свай» при попытке записать сваю — и пройти этот
 * чек-лист в модуле было НЕГДЕ. Свайный цикл не завершался вовсе.
 */
/**
 * Периодические чек-листы ТБ. Список — сроки; ответы — на общем экране
 * чек-листа (описание замечаний, фото, замеры), тот же, что в /operator и v7.
 * Свой список пунктов v10 не спрашивал описания и фото, и сервер отказывал
 * в сдаче без видимой причины.
 */
export function ScreenSafetyChecklists({state, busy, error, commandId, onSubmit, go}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  commandId: string;
  onSubmit: (stage: ChecklistStage, answers: ChecklistAnswer[], restoredCommandId?: string) => Promise<boolean>;
  go: Go;
}) {
  const [open, setOpen] = useState<ChecklistStage | null>(null);
  const lists = state.checklists.filter((list) => list.period !== null);
  const opened = open ? lists.find((list) => list.stage === open) : undefined;
  if (opened) {
    return (
      <ChecklistScreen
        draftUserId={state.operator?.id}
        draftShiftId={state.shift?.id}
        key={`${state.shift?.id}:${state.assignment?.equipmentId}:${opened.stage}`}
        checklist={opened}
        warnings={state.warnings}
        busy={busy}
        error={error}
        commandId={commandId}
        lastMeter={state.assignment?.lastMeter ?? null}
        known={knownAnswers(opened.stage, state)}
        onBack={() => setOpen(null)}
        onSubmit={async (answers, restoredCommandId) => {
          const ok = await onSubmit(opened.stage, answers, restoredCommandId);
          if (ok) setOpen(null);
          return ok;
        }}
      />
    );
  }
  return (
    <>
      <Card title="Чек-листы ТБ">
        {lists.length === 0
          ? <Nodata>Чек-листы ТБ недоступны</Nodata>
          : lists.map((list) => {
            const period = list.period;
            const due = period?.due ?? false;
            const warn = period?.warn ?? false;
            return (
              // Пройти заранее — законное действие: список открыт и когда
              // срок ещё не вышел.
              <Row
                key={list.stage}
                icon="safety"
                tone={due ? 'bad' : warn ? 'warn' : 'ok'}
                title={list.title}
                note={due
                  ? 'срок подошёл — без него запись выработки не примут'
                  : warn ? `срок через ${period?.daysLeft} дн.` : `действует до ${dateRu(period?.validUntil)}`}
                chevron
                onClick={() => setOpen(list.stage)}
              />
            );
          })}
      </Card>
      <button type="button" className="ov10-btn ghost" onClick={() => go('safety')}>К разделу ТБ</button>
    </>
  );
}

/**
 * Закрытие смены. Поля комментария здесь нет (решение владельца 18.09.2026):
 * то, что надо передать следующей смене, — это передача машины, отдельное
 * действие со своим адресатом, а не строчка в закрытии.
 */
export function ScreenClosing({state, busy, onFinish, onClose, go, unsent, onFlush}: {
  state: OperatorMobileState;
  busy: boolean;
  /** «Завершить работу» — сервер переводит смену в сдачу (finish-work). */
  onFinish: () => void;
  onClose: () => void;
  go: Go;
  /** Записей на устройстве, ещё не принятых сервером. */
  unsent: number;
  /** Отправить их немедленно. */
  onFlush: () => void;
}) {
  const {assignment} = state;
  const oldDate = state.shift && state.shift.productionDate < state.productionDate
    ? dateRu(state.shift.productionDate) : null;
  const [confirmFinish, setConfirmFinish] = useState(false);
  // До работы закрывать нечего: закрытие открывается в свою очередь, а не с
  // первой минуты смены (жалоба 28.09.2026 «можно сразу закрыть смену»).
  if (stepIndex(state.phase) < stepIndex('WORK')) return <NotYet state={state} go={go} />;

  /*
   * ЗАВЕРШИТЬ РАБОТУ — ОТДЕЛЬНЫМ ДЕЙСТВИЕМ С ПОДТВЕРЖДЕНИЕМ.
   *
   * Раньше кнопка на экране работы только открывала этот экран: на сервер
   * «работа завершена» не уходило вовсе, и смена оставалась в работе.
   * Завершение переводит смену к ЕО после работы и сдаче — поэтому второе
   * нажатие, а не одно.
   */
  if (state.phase === 'WORK') {
    return (
      <>
        <Card>
          <Row icon="list" title="Записи выработки" note={String(state.entries.length)} />
          <Row icon="warning" tone={state.defects.length > 0 ? 'warn' : 'ok'} title="Дефекты"
            note={String(state.defects.length)} />
        </Card>
        <Banner tone="warn" title="После «Завершить работу» — ЕО после работы и закрытие смены">
          {' '}Сваи, бурение и простой можно дописать до сдачи смены.
        </Banner>
        {confirmFinish ? (
          <>
            <button type="button" className="ov10-btn orange" disabled={busy} onClick={onFinish}>
              {busy ? 'Завершаем…' : 'Да, работа на сегодня закончена'}
            </button>
            <button type="button" className="ov10-btn ghost" onClick={() => setConfirmFinish(false)}>Продолжить работу</button>
          </>
        ) : (
          <>
            <button type="button" className="ov10-btn orange" disabled={busy} onClick={() => setConfirmFinish(true)}>
              Завершить работу
            </button>
            <button type="button" className="ov10-btn ghost" onClick={() => go('work')}>{oldDate ? `Дописать отчёт за ${oldDate}` : 'К записи выработки'}</button>
          </>
        )}
      </>
    );
  }

  const closed = state.phase === 'CLOSED';
  // Сервер не закроет смену без послесменного обслуживания.
  const afterDone = state.checklists.some((list) => list.stage === 'EO_AFTER' && list.done);
  return (
    <>
      <div className="ov10-metrics">
        <Metric label="Моточасы"
          value={assignment?.lastMeter ? formatNumber(assignment.lastMeter.engineHours, 0) : DASH} note="м/ч" />
        <Metric label="Топливо"
          value={assignment?.fuelPercent === null || assignment?.fuelPercent === undefined
            ? DASH : `${formatNumber(assignment.fuelPercent, 0)}%`} note="прошлая смена" />
      </div>
      <Card>
        <Row icon="warning" tone={state.defects.length > 0 ? 'warn' : 'ok'} title="Дефекты"
          note={String(state.defects.length)} />
        <Row icon="list" title="Записи выработки" note={String(state.entries.length)} />
      </Card>
      {/* Номер отчёта — здесь, а не только на экране «Отчёт и синхронизация».
          Человек закрывает смену на этом экране и уходит; номер, которым смену
          опознают в разговоре с диспетчером, не должен лежать через два
          нажатия в другом разделе. */}
      {closed && state.receipt ? (
        <Card title="Квитанция">
          <Pair label="Отчёт" value={state.receipt.reportId} />
          <Pair label="Отправлен" value={dateRu(state.receipt.submittedAt)} />
        </Card>
      ) : null}
      {closed ? <ShiftThanks operatorName={state.operator?.name} reportSent={Boolean(state.receipt?.submittedAt)} /> : null}
      {!closed && !afterDone ? (
        <>
          <Banner tone="warn" title="Сначала ЕО после работы" />
          <button type="button" className="ov10-btn green" onClick={() => go('step')}>
            Пройти ЕО после работы
          </button>
        </>
      ) : null}
      {!closed && unsent > 0 ? (
        <>
          <Banner tone="warn" title={`Сначала отправьте записи с телефона: ${unsent} не отправлено`} />
          <button type="button" className="ov10-btn ghost" onClick={onFlush}>
            Отправить сейчас
          </button>
        </>
      ) : null}
      {!closed && afterDone ? (
        <button type="button" className="ov10-btn orange" disabled={busy || unsent > 0} onClick={onClose}>
          {busy ? 'Закрываем…' : 'Закрыть смену и отправить отчёт'}
        </button>
      ) : null}
      {!closed ? (
        <button type="button" className="ov10-btn ghost" onClick={() => go('work')}>{oldDate ? `Дописать отчёт за ${oldDate}` : 'Дописать сваи, бурение или простой'}</button>
      ) : null}
    </>
  );
}

export function ScreenReport({state}: {state: OperatorMobileState}) {
  const done = state.checklists.filter((list) => list.done).length;
  const queue: {id: string; title: string; status: string; tone: 'ok' | 'warn'}[] = [
    {
      id: 'shift', title: 'Состояние смены',
      status: state.shift ? 'получено' : 'смена не начата', tone: state.shift ? 'ok' : 'warn',
    },
    {
      id: 'docs', title: `Документы допуска (${state.identity.documents.length})`,
      status: state.identity.documents.length > 0 ? 'получены' : 'нет данных',
      tone: state.identity.documents.length > 0 ? 'ok' : 'warn',
    },
    {
      id: 'checklists', title: `Чек-листы (${done} из ${state.checklists.length})`,
      status: state.checklists.length > 0 && done === state.checklists.length ? 'пройдены' : 'ожидают',
      tone: state.checklists.length > 0 && done === state.checklists.length ? 'ok' : 'warn',
    },
    {
      id: 'entries', title: `Записи выработки (${state.entries.length})`,
      status: state.entries.length > 0 ? 'записаны' : 'пусто',
      tone: state.entries.length > 0 ? 'ok' : 'warn',
    },
  ];
  return (
    <>
      <div className="ov10-metrics three">
        <Metric label="Сваи" value={formatNumber(state.production.piles.count, 0)}
          note={`${formatNumber(state.production.piles.meters, 0)} м.п.`} />
        <Metric label="Бурение" value={formatNumber(state.production.drilling.count, 0)}
          note={`${formatNumber(state.production.drilling.meters, 0)} м.п.`} />
        <Metric label="Простой" value={formatDowntimeHoursOnly(state.production.downtimeHours)} />
      </div>
      <Card title="Состояние модуля">
        {queue.map((item) => (
          <Row key={item.id} icon={item.tone === 'ok' ? 'check' : 'clock'} tone={item.tone}
            title={item.title} note={item.status} />
        ))}
      </Card>
      {state.receipt ? (
        <Card title="Квитанция">
          <Pair label="Отчёт" value={state.receipt.reportId} />
          <Pair label="Отправлен" value={dateRu(state.receipt.submittedAt)} />
        </Card>
      ) : null}
    </>
  );
}

/** ТБ и допуски — тот же личный раздел, что во вкладке ТБ модуля v7. */
/**
 * Вкладка «ТБ» — шаги допуска к смене по эталону визуализации.
 *
 * Пять строк вместо трёх: к СИЗ, инструкции и проверке знаний добавлены
 * «Подпись» и «Допуск к смене». Обе — не действия, а факты, и нажатия под ними
 * нет; почему именно так — в `safety/admission-steps.ts`.
 */
export function ScreenSafety({state, view, error, go}: {
  state: OperatorMobileState | null;
  view: SelfSafetyView | null;
  error: string | null;
  go: Go;
}) {
  const steps = state ? admissionSteps(state) : [];
  const left = admissionBlockers(steps);
  const pending = view ? view.briefings.pending.length + view.briefings.overdue.length : 0;
  return (
    <>
      {state ? (
        <Card title="Перед сменой">
          {steps.map((step) => (
            <Row
              key={step.id}
              icon={STEP_ICON[step.id]}
              tone={step.done ? 'ok' : step.id === 'ADMISSION' ? 'warn' : ''}
              title={`${step.n}. ${step.title}`}
              note={`${step.hint} · ${step.note}`}
              chevron={step.opens !== null}
              onClick={step.opens ? () => go(STEP_SCREEN[step.opens as 'PPE' | 'BRIEFING' | 'KNOWLEDGE']) : undefined}
            />
          ))}
        </Card>
      ) : null}
      {state ? (
        <Banner tone={left.length === 0 ? 'info' : 'warn'} title={left.length === 0
          ? 'Все шаги пройдены'
          : `Осталось: ${left.join(', ')}`}>
          {' '}Прохождение занимает 5–10 минут.
        </Banner>
      ) : null}
      {error ? <Card><Nodata>{error}</Nodata></Card> : null}
      {!view && !error ? <Card><Nodata>Читаем ваш допуск…</Nodata></Card> : null}
      {view ? (
      <>
      <Card>
        <Row icon="shield" tone={view.clearance.cleared ? 'ok' : 'bad'}
          title={view.clearance.cleared ? 'Допуск по документам' : 'Допуск не оформлен'}
          note={view.clearance.cleared
            ? state && left.length === 0 ? 'все шаги допуска пройдены' : 'по документам препятствий нет; завершите шаги допуска выше'
            : `препятствий: ${view.clearance.blockers.length}`} />
        <Row icon="inspect" tone={pending > 0 ? 'warn' : 'ok'} title="Инструктажи"
          note={pending > 0 ? `ожидают: ${pending}` : 'пройдены'} />
      </Card>
      {/* Список документов сюда не разворачиваем: одиннадцать строк «действует
          до 14.09.2029» отодвигают шаги допуска на два экрана вниз. Одна
          строка отвечает на тот же вопрос, а список — в одном нажатии. */}
      <Card>
        <Row icon="doc" tone={documentsTone(state)} title="Документы"
          note={state ? documentsSummary(state.identity.documents).note : `всего: ${view.clearance.documents.length}`}
          chevron onClick={() => go('docs')} />
      </Card>
      <Card>
        <Row icon="safety" tone={tbTone(state)} title="Чек-листы ТБ по видам работ"
          note={tbNote(state)} chevron onClick={() => go('tb')} />
      </Card>
      <Card>
        <Row icon="warn" tone={state && state.incidents.length > 0 ? 'warn' : 'ok'}
          title="Происшествия смены"
          note={state && state.incidents.length > 0
            ? `записано: ${state.incidents.length}`
            : 'записать ушиб, постороннего в зоне, разлив'}
          chevron onClick={() => go('incidents')} />
      </Card>
      <Card title="Журнал ТБ">
        {view.history.length === 0
          ? <Nodata>Записей пока нет</Nodata>
          : view.history.slice(0, 5).map((record) => (
            <Row key={record.id} icon="doc" title={record.documentTitle}
              note={`${dateRu(record.recordedAt)}${record.result ? ` · ${record.result}` : ''}`} />
          ))}
      </Card>
      </>
      ) : null}
    </>
  );
}
