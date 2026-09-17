'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  ChecklistView, DocumentVerdict, OperatorAnswer, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {PPE_ITEMS, SAFETY_BRIEFING, TOPIC_LABELS, measureRequired} from '@/modules/operator-mobile/contracts';
import type {KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {admissionBlockers, admissionSteps} from '../safety/admission-steps';
import {documentsSummary} from '../safety/documents-summary';
import type {SelfSafetyView} from '@/modules/safety/application/self-clearance-query';
import {ApiError, QueuedOffline, currentPosition, fetchState, newCommandId, sendCommand} from '../api';
import {formatHours, formatNumber} from '@/lib/format';
import {
  Badge, Banner, Card, Icon, Metric, Navbar, Nodata, Pair, Row, StatusBar, Tabbar,
  type ScreenTab, type Tone,
} from './v10-ui';

/**
 * Модуль оператора v10 — рабочее место машиниста на телефоне.
 *
 * ЧТО ЗДЕСЬ ПОКАЗАНО. Только то, что пришло с сервера. Демонстрационных
 * значений в живом пути нет ни одного: пустое поле показывается прочерком, а
 * не значением макета. Так было не всегда — прежняя версия подставляла
 * «ЖК Северный квартал» и документ «№ 77MA 123456 · действует» вместо
 * недостающих полей, и делала это при уже зажжённой пометке «данные с
 * сервера». На экране допуска и документов это самая дорогая ложь из
 * возможных: человек уходит на площадку, считая, что допуск есть.
 *
 * ЧТО ЗДЕСЬ МОЖНО СДЕЛАТЬ. Приём установки, предсменный осмотр (с ответом по
 * каждому пункту) и закрытие смены. Правила проверяет сервер: порядок этапов,
 * право записывать и условия закрытия живут там, экран только подсказывает.
 *
 * ПОЧЕМУ ОСМОТР НЕЛЬЗЯ СДАТЬ ОДНОЙ КНОПКОЙ. Прежняя версия на «Подтвердить
 * готовность» отправляла весь чек-лист с ответом «норма» по каждому пункту —
 * гусеницы, трещины в мачте, обрывы прядей троса, замок обоймы, — не показав
 * человеку ни одного. Осмотр это доказательство, что машину смотрели; такая
 * кнопка превращала его в доказательство, что нажали кнопку. Теперь ответы
 * проставляет человек, и пока есть пункты без ответа, сдать нельзя.
 */

/* ------------------------------------------------------- вспомогательное --- */

const DOC_LABEL: Record<DocumentVerdict, string> = {
  VALID: 'действует', EXPIRING: 'истекает', EXPIRED: 'просрочен', MISSING: 'не заведён',
};

const DOC_TONE: Record<DocumentVerdict, Tone> = {
  VALID: 'ok', EXPIRING: 'warn', EXPIRED: 'bad', MISSING: 'bad',
};

/** Прочерк вместо выдуманного значения. */
const DASH = '—';

function dateRu(value: Date | string | null | undefined): string {
  if (!value) return DASH;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return DASH;
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function timeRu(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}

function shiftType(): 'DAY' | 'NIGHT' {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19 ? 'DAY' : 'NIGHT';
}

/* --------------------------------------------------------------- экраны --- */

interface ScreenDef {
  id: string;
  n: number;
  title: string;
  short: string;
  tab: string;
}

const SCREENS: ScreenDef[] = [
  {id: 'today', n: 1, title: 'Смена', short: 'Лента смены', tab: 'today'},
  {id: 'docs', n: 2, title: 'Документы', short: 'Документы', tab: 'more'},
  {id: 'accept', n: 3, title: 'Принять установку', short: 'Приёмка', tab: 'today'},
  {id: 'inspect', n: 4, title: 'Предсменный осмотр', short: 'Осмотр', tab: 'today'},
  {id: 'ready', n: 5, title: 'Готовность', short: 'Готовность', tab: 'today'},
  {id: 'work', n: 6, title: 'Работа', short: 'Работа', tab: 'today'},
  {id: 'maint', n: 7, title: 'Ежесменное обслуживание', short: 'Обслуживание', tab: 'equip'},
  {id: 'closing', n: 8, title: 'Закрытие смены', short: 'Закрытие', tab: 'more'},
  {id: 'report', n: 9, title: 'Отчёт и синхронизация', short: 'Отчёт', tab: 'more'},
  {id: 'safety', n: 10, title: 'ТБ и допуски', short: 'ТБ', tab: 'safety'},
  {id: 'ppe', n: 11, title: 'Средства защиты', short: 'СИЗ', tab: 'safety'},
  {id: 'briefing', n: 12, title: 'Ознакомление с инструкцией', short: 'Инструкция', tab: 'safety'},
  {id: 'knowledge', n: 13, title: 'Проверка знаний по ТБ', short: 'Знания', tab: 'safety'},
  {id: 'more', n: 14, title: 'Ещё', short: 'Ещё', tab: 'more'},
];

/**
 * Нижнее меню: четыре раздела, один набор во всех модулях оператора.
 *
 * Было шесть. «Работа» ушла в «Смену» — приёмка, осмотр и учёт это один
 * сквозной ход, и разрывать его вкладкой незачем. «Отчёт» ушёл в «Ещё»:
 * закрытие смены бывает раз в день, а постоянная кнопка под однократное
 * действие — это шесть часов мёртвого места.
 */
const TABS: ScreenTab[] = [
  {key: 'today', title: 'Смена', icon: 'home', screen: 'today'},
  {key: 'safety', title: 'ТБ', icon: 'safety', screen: 'safety'},
  {key: 'equip', title: 'Техника', icon: 'equip', screen: 'maint'},
  {key: 'more', title: 'Ещё', icon: 'more', screen: 'more'},
];

/* ------------------------------------------------------------ состояние --- */

type Go = (id: string) => void;

function ScreenToday({state, go}: {state: OperatorMobileState; go: Go}) {
  /*
   * Допуск объявляет СЕРВЕР своей фазой, а не экран по документам.
   *
   * Документы — только часть допуска: до работы человек ещё подтверждает СИЗ,
   * читает инструкцию и проходит проверку знаний. Пока сервер держит фазу
   * IDENTITY, зелёное «Допуск получен» по одним корочкам — это обещание,
   * которого сервер не давал.
   */
  const passed = state.phase !== 'IDENTITY';
  const {identity} = state;
  const left = [
    identity.ppe.confirmed ? null : 'СИЗ',
    identity.briefing.ok ? null : 'инструктаж',
    identity.knowledge.ok ? null : 'проверка знаний',
  ].filter(Boolean);

  /* `expiresAt` объявлен как `Date`, но через JSON приходит строкой — сравнение
     по `instanceof Date` не находило ни одной даты, и срок всегда был «не
     указан». Разбираем оба вида. */
  const nearest = state.identity.documents
    .filter((doc) => doc.required && doc.expiresAt)
    .map((doc) => new Date(doc.expiresAt as unknown as string))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return (
    <>
      <Card>
        <Row
          icon="shield"
          tone={passed ? 'ok' : 'warn'}
          title={passed ? 'Допуск получен' : 'Допуск не пройден'}
          note={passed
            ? (nearest ? `ближайший срок документа ${dateRu(nearest)}` : 'сроки документов не указаны')
            : `осталось: ${left.join(', ')}`}
          chevron
          onClick={() => go(passed ? 'docs' : 'safety')}
        />
      </Card>
      <Card>
        <Row icon="pin" tone="orange" title="Объект"
          note={state.assignment?.siteName ?? 'не назначен'} chevron onClick={() => go('accept')} />
        <Row icon="equip" title="Установка"
          note={state.assignment?.equipmentName ?? 'не закреплена'} chevron onClick={() => go('accept')} />
      </Card>
      <Card>
        <Row icon="check" tone="orange" title="Следующее действие" note={nextAction(state)}
          chevron onClick={() => go(nextScreen(state))} />
      </Card>
    </>
  );
}

/** Что делать дальше — по фазе, которую посчитал сервер. */
function nextAction(state: OperatorMobileState): string {
  switch (state.phase) {
    case 'IDENTITY': return 'Пройти допуск: СИЗ, инструктаж, знания';
    case 'ADMISSION': return 'Принять установку';
    case 'PRESHIFT_INSPECTION': return 'Пройти предсменный осмотр';
    case 'STARTUP': return 'Пуск и ежесменное обслуживание';
    case 'SITE_READY': return 'Осмотреть площадку';
    case 'WORK': return 'Записывать выработку';
    case 'CLOSING': return 'Закрыть смену';
    default: return 'Смена закрыта';
  }
}

function nextScreen(state: OperatorMobileState): string {
  switch (state.phase) {
    case 'IDENTITY': return 'safety';
    case 'ADMISSION': return 'accept';
    case 'PRESHIFT_INSPECTION': return 'inspect';
    case 'WORK': return 'work';
    case 'CLOSING': case 'CLOSED': return 'closing';
    default: return 'maint';
  }
}

function ScreenDocs({state}: {state: OperatorMobileState}) {
  if (state.identity.documents.length === 0) {
    return <Card><Nodata>Документы не заведены</Nodata></Card>;
  }
  return (
    <Card>
      {state.identity.documents.map((doc) => (
        <Row
          key={doc.typeId}
          icon="doc"
          tone={DOC_TONE[doc.verdict]}
          title={doc.name}
          note={[
            doc.number ? `№ ${doc.number}` : 'номер не указан',
            doc.expiresAt ? `до ${dateRu(doc.expiresAt)}` : DOC_LABEL[doc.verdict],
          ].join(' · ')}
        />
      ))}
    </Card>
  );
}

function ScreenAccept({state, busy, onAccept, go}: {
  state: OperatorMobileState; busy: boolean; onAccept: () => void; go: Go;
}) {
  const {assignment, weather} = state;
  const accepted = state.phase !== 'IDENTITY' && state.phase !== 'ADMISSION';
  return (
    <>
      <Card>
        <Row icon="pin" tone="orange" title="Объект" note={assignment?.siteName ?? 'не назначен'} />
        <Row icon="equip" title="Установка"
          note={assignment ? `${assignment.equipmentName} · ${assignment.equipmentModel}` : 'не закреплена'} />
        <Row icon="user" title="Помощники" note={assignment?.assistants.join(', ') || 'нет'} />
      </Card>
      <div className="ov10-metrics">
        <Metric
          label="Моточасы"
          value={assignment?.lastMeter ? formatNumber(assignment.lastMeter.engineHours, 0) : DASH}
          note={assignment?.lastMeter ? `на ${dateRu(assignment.lastMeter.recordedAt)}` : 'нет показаний'}
        />
        <Metric
          label="Топливо"
          value={assignment?.fuelPercent === null || assignment?.fuelPercent === undefined
            ? DASH
            : `${formatNumber(assignment.fuelPercent, 0)}%`}
          note="на конец прошлой смены"
        />
      </div>
      <Card title="Погода">
        {weather ? (
          <>
            <Pair label="Температура" value={weather.temperatureC === null ? DASH : `${formatNumber(weather.temperatureC, 0)} °C`} />
            <Pair label="Ветер" value={weather.windMs === null ? DASH : `${formatNumber(weather.windMs, 1)} м/с`} />
            <Pair label="Осадки" value={weather.precipitationMmPerHour === null ? DASH : `${formatNumber(weather.precipitationMmPerHour, 1)} мм/ч`} />
          </>
        ) : <Nodata>Погода недоступна — координаты не переданы</Nodata>}
      </Card>
      {accepted
        ? <Banner tone="info" title="Установка уже принята" />
        : (
          <button type="button" className="ov10-btn" disabled={busy} onClick={onAccept}>
            {busy ? 'Принимаем…' : 'Принять установку'}
          </button>
        )}
      <button type="button" className="ov10-btn ghost" onClick={() => go('inspect')}>К предсменному осмотру</button>
    </>
  );
}

const ANSWERS: {value: OperatorAnswer; label: string; cls: string}[] = [
  {value: 'OK', label: 'Норма', cls: 'ok'},
  {value: 'REMARK', label: 'Замечание', cls: 'warn'},
  {value: 'FAULT', label: 'Дефект', cls: 'bad'},
];

/**
 * Предсменный осмотр: ответ по каждому пункту.
 *
 * Разделы эталона оставлены заголовками, но отвечают не за раздел, а за пункт:
 * один ответ на шесть пунктов — это тот же «всё норма», только руками.
 */
function ScreenInspect({checklist, answers, onAnswer, go}: {
  checklist: ChecklistView | undefined;
  answers: Record<string, OperatorAnswer>;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  go: Go;
}) {
  if (!checklist) {
    return <Card><Nodata>Осмотр станет доступен после приёма установки</Nodata></Card>;
  }
  if (checklist.done) {
    return (
      <>
        <Banner tone="info" title="Осмотр сдан" />
        <Card title={checklist.title}>
          <Pair label="Версия" value={checklist.version} />
          <Pair label="Разделов" value={String(checklist.sections.length)} />
        </Card>
      </>
    );
  }
  return (
    <>
      {checklist.sections.map((section) => (
        <Card key={section.id} title={section.title}>
          {section.items.map((item) => (
            <div className="ov10-item" key={item.id}>
              <div className="t">{item.text}</div>
              {item.hint ? <div className="s">{item.hint}</div> : null}
              <div className="ov10-chips">
                {ANSWERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={answers[item.id] === option.value}
                    className={`${answers[item.id] === option.value ? 'on ' : ''}${option.cls}`}
                    onClick={() => onAnswer(item.id, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      ))}
      <button type="button" className="ov10-btn ghost" onClick={() => go('ready')}>К готовности</button>
    </>
  );
}

function ScreenReady({state, checklist, answers, busy, onSubmit, go}: {
  state: OperatorMobileState;
  checklist: ChecklistView | undefined;
  answers: Record<string, OperatorAnswer>;
  busy: boolean;
  onSubmit: () => void;
  go: Go;
}) {
  const items = checklist ? checklist.sections.flatMap((section) => section.items) : [];
  const unanswered = items.filter((item) => !answers[item.id]);
  const needMeasure = items.filter((item) => {
    const answer = answers[item.id];
    return Boolean(answer) && Boolean(item.measure) && measureRequired(item, answer);
  });
  const stop = state.warnings.filter((warning) => warning.level === 'STOP');
  const done = Boolean(checklist?.done);

  return (
    <>
      <Card>
        <Row icon="warning" tone={state.defects.length > 0 ? 'warn' : 'ok'} title="Дефекты"
          note={state.defects.length > 0 ? `открыто: ${state.defects.length}` : 'нет'}
          chevron onClick={() => go('maint')} />
        <Row icon="minus" tone={stop.length > 0 ? 'bad' : 'ok'} title="Блокирующие"
          note={stop.length > 0 ? stop.map((warning) => warning.title).join('; ') : 'нет'} />
      </Card>
      <Card title="Вердикт">
        <Row
          icon="shield"
          tone={done ? 'ok' : 'warn'}
          title={done ? 'Осмотр сдан' : 'Осмотр не закрыт'}
          note={done
            ? 'можно приступать'
            : `без ответа: ${unanswered.length} из ${items.length}`}
        />
      </Card>
      {needMeasure.length > 0 ? (
        <Banner tone="warn" title={`Нужен замер по пунктам: ${needMeasure.length}`}>
          {' '}— их заполняют на рабочем экране смены.
        </Banner>
      ) : null}
      {done ? null : (
        <button
          type="button"
          className="ov10-btn green"
          disabled={busy || items.length === 0 || unanswered.length > 0 || needMeasure.length > 0}
          onClick={onSubmit}
        >
          {busy ? 'Отправляем…' : unanswered.length > 0 ? `Осталось ответить: ${unanswered.length}` : 'Сдать осмотр'}
        </button>
      )}
    </>
  );
}

function ScreenWork({state, go}: {state: OperatorMobileState; go: Go}) {
  const {assignment} = state;
  return (
    <>
      <Card>
        <Row icon="user" title={state.operator.name}
          note={state.shift?.startedAt ? `смена с ${timeRu(state.shift.startedAt)}` : 'смена не начата'} />
      </Card>
      <div className="ov10-metrics">
        <Metric label="Моточасы"
          value={assignment?.lastMeter ? formatNumber(assignment.lastMeter.engineHours, 0) : DASH} note="м/ч" />
        <Metric label="Топливо"
          value={assignment?.fuelPercent === null || assignment?.fuelPercent === undefined
            ? DASH : `${formatNumber(assignment.fuelPercent, 0)}%`} note="прошлая смена" />
      </div>
      <div className="ov10-metrics three">
        <Metric label="Сваи" value={formatNumber(state.production.piles.count, 0)}
          note={`${formatNumber(state.production.piles.meters, 0)} м.п.`} />
        <Metric label="Бурение" value={formatNumber(state.production.drilling.count, 0)}
          note={`${formatNumber(state.production.drilling.meters, 0)} м.п.`} />
        <Metric label="Простой" value={formatHours(state.production.downtimeHours)} />
      </div>
      <Banner tone="info" title="Запись выработки — на рабочем экране">
        {' '}Свая, бурение и простой требуют выбора марки и причины: формы живут на «Смене машиниста».
      </Banner>
      <button type="button" className="ov10-btn ghost" onClick={() => go('closing')}>К закрытию смены</button>
    </>
  );
}

function ScreenMaint({state, go}: {state: OperatorMobileState; go: Go}) {
  const lists = state.checklists.filter(
    (list) => list.stage === 'EO_BEFORE' || list.stage === 'EO_AFTER');
  return (
    <>
      {lists.length === 0
        ? <Card><Nodata>Чек-листы обслуживания недоступны</Nodata></Card>
        : lists.map((list) => (
          <Card key={list.stage} title={list.title}>
            <Row icon="wrench" tone={list.done ? 'ok' : 'warn'} title={list.done ? 'Выполнено' : 'Не отмечено'}
              note={`${list.sections.reduce((sum, section) => sum + section.items.length, 0)} пунктов · версия ${list.version}`} />
          </Card>
        ))}
      <Card title="Открытые неисправности">
        {state.defects.length === 0
          ? <Nodata>Открытых неисправностей нет</Nodata>
          : state.defects.map((defect) => (
            <Row key={defect.id} icon="warning" tone="warn" title={defect.title}
              note={`${defect.reportedByMe ? 'записали вы' : defect.reportedByName} · ${dateRu(defect.reportedAt)}`} />
          ))}
      </Card>
      <button type="button" className="ov10-btn ghost" onClick={() => go('work')}>К смене</button>
    </>
  );
}

function ScreenClosing({state, busy, comment, onComment, onClose}: {
  state: OperatorMobileState;
  busy: boolean;
  comment: string;
  onComment: (value: string) => void;
  onClose: () => void;
}) {
  const {assignment} = state;
  const closed = state.phase === 'CLOSED';
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
      <Card title="Комментарий">
        {/* Поле пустое. Прежняя версия подставляла сюда фразу из макета — и
            выдуманное «бетонирование сваи С-131 не завершено» уходило в
            закрытие настоящей смены как слова машиниста. */}
        <textarea
          className="ov10-textarea"
          value={comment}
          placeholder="Что передать следующей смене"
          onChange={(event) => onComment(event.target.value)}
        />
      </Card>
      {closed
        ? <Banner tone="info" title="Смена закрыта" />
        : (
          <button type="button" className="ov10-btn orange" disabled={busy} onClick={onClose}>
            {busy ? 'Закрываем…' : 'Закрыть смену'}
          </button>
        )}
    </>
  );
}

function ScreenReport({state}: {state: OperatorMobileState}) {
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
        <Metric label="Простой" value={formatHours(state.production.downtimeHours)} />
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
function ScreenSafety({state, view, error, go}: {
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
          title={view.clearance.cleared ? 'Допуск в порядке' : 'Допуск не оформлен'}
          note={view.clearance.cleared
            ? 'препятствий к работе нет'
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

/** «Ещё»: разделы, которые открывают раз в смену, а не раз в час. */
function ScreenMore({state, go}: {state: OperatorMobileState; go: Go}) {
  const summary = documentsSummary(state.identity.documents);
  return (
    <Card>
      <Row icon="doc" title="Документы" note={summary.note} chevron onClick={() => go('docs')} />
      <Row icon="handoff" title="Закрытие смены"
        note={state.shift ? 'сдать смену и записать замечания' : 'смена не открыта'}
        chevron onClick={() => go('closing')} />
      <Row icon="report" title="Отчёт и синхронизация" note="что уже ушло на сервер"
        chevron onClick={() => go('report')} />
    </Card>
  );
}

/* --------------------------------------------------- шаги допуска (ТБ) --- */

/** СИЗ: отмечает человек, нехватка записывается как есть и не запирает экран. */
function ScreenPpe({state, busy, onConfirm}: {
  state: OperatorMobileState;
  busy: boolean;
  onConfirm: (items: string[]) => void;
}) {
  const [items, setItems] = useState<string[]>(
    state.identity.ppe.confirmed && state.identity.ppe.items.length > 0
      ? state.identity.ppe.items
      : PPE_ITEMS.map((item) => item.code),
  );
  const missing = PPE_ITEMS.filter((item) => !items.includes(item.code));
  const toggle = (code: string) => setItems((current) => (
    current.includes(code) ? current.filter((value) => value !== code) : [...current, code]
  ));

  return (
    <>
      <Card title="Отметьте то, что у вас есть и исправно">
        {PPE_ITEMS.map((item) => (
          <Row
            key={item.code}
            icon={items.includes(item.code) ? 'check' : 'minus'}
            tone={items.includes(item.code) ? 'ok' : 'bad'}
            title={item.label}
            note={item.hint}
            onClick={() => toggle(item.code)}
          />
        ))}
      </Card>
      {missing.length > 0 ? (
        <Banner tone="warn" title={`Не хватает: ${missing.map((item) => item.label).join(', ')}`}>
          {' '}Запишем как есть — нехватка уйдёт предупреждением диспетчеру.
        </Banner>
      ) : null}
      <button type="button" className="ov10-btn" disabled={busy} onClick={() => onConfirm(items)}>
        {busy ? 'Записываем…' : 'Подтвердить проверку'}
      </button>
    </>
  );
}

/** Ознакомление с инструкцией: текст целиком, затем отметка. */
function ScreenBriefing({state, busy, onAcknowledge}: {
  state: OperatorMobileState;
  busy: boolean;
  onAcknowledge: () => void;
}) {
  const [read, setRead] = useState(false);
  const {briefing} = state.identity;
  return (
    <>
      <Card>
        <Row icon="doc" tone={briefing.ok ? 'ok' : 'warn'} title={SAFETY_BRIEFING.title}
          note={`${SAFETY_BRIEFING.code} · версия ${briefing.version} · чтение ${SAFETY_BRIEFING.readingMinutes} мин`} />
      </Card>
      {SAFETY_BRIEFING.sections.map((section) => (
        <Card key={section.id} title={section.title}>
          {section.rules.map((rule) => (
            <div className="ov10-item" key={rule}><div className="t">{rule}</div></div>
          ))}
        </Card>
      ))}
      <Card>
        <Row
          icon={read ? 'check' : 'minus'}
          tone={read ? 'ok' : ''}
          title="Я ознакомился с инструкцией"
          note="понимаю требования и обязуюсь их соблюдать"
          onClick={() => setRead((value) => !value)}
        />
      </Card>
      <button type="button" className="ov10-btn" disabled={busy || !read} onClick={onAcknowledge}>
        {busy ? 'Записываем…' : 'Ознакомлен'}
      </button>
    </>
  );
}

interface Attempt {questions: KnowledgeQuestion[]; attemptToken: string}

/**
 * Проверка знаний.
 *
 * Ошибка не заваливает попытку: показываем верный ответ, вопрос возвращается в
 * конец очереди. Цель — чтобы человек ушёл на площадку, зная правило, а не
 * чтобы он не прошёл. Итог всё равно считает сервер по своему банку.
 */
function ScreenKnowledge({busy, onDone}: {
  busy: boolean;
  onDone: (picks: {questionId: string; picked: number}[], attemptToken: string) => void;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<KnowledgeQuestion[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const [picks, setPicks] = useState<Record<string, number>>({});

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/operator/knowledge-attempt', {cache: 'no-store', signal: abort.signal})
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Не удалось получить вопросы');
        if (abort.signal.aborted) return;
        setAttempt(payload.data as Attempt);
        setQueue((payload.data as Attempt).questions);
      })
      .catch((cause: Error) => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, []);

  if (error) return <Card><Nodata>{error}</Nodata></Card>;
  if (!attempt) return <Card><Nodata>Получаем вопросы…</Nodata></Card>;

  const total = attempt.questions.length;
  const question = queue[0];

  if (!question) {
    return (
      <>
        <Card><Row icon="check" tone="ok" title="Все ответы верные" note={`${total} из ${total}`} /></Card>
        <button
          type="button"
          className="ov10-btn green"
          disabled={busy}
          onClick={() => onDone(
            Object.entries(picks).map(([questionId, value]) => ({questionId, picked: value})),
            attempt.attemptToken,
          )}
        >
          {busy ? 'Записываем…' : 'Записать результат'}
        </button>
      </>
    );
  }

  const answered = total - queue.length;
  const correct = picked !== null && picked === question.correct;
  const next = () => {
    if (picked === null) return;
    setPicks((current) => ({...current, [question.id]: picked}));
    setQueue((current) => (picked === question.correct
      ? current.slice(1)
      : [...current.slice(1), question]));
    setPicked(null);
    setShown(false);
  };

  return (
    <>
      <Card title={`Вопрос ${answered + 1} из ${total} · ${TOPIC_LABELS[question.topic]}`}>
        <div className="ov10-item">
          <div className="t">{question.text}</div>
        </div>
        {question.options.map((option, index) => (
          <Row
            key={option}
            icon={picked === index ? 'check' : 'minus'}
            tone={picked === index ? 'ok' : ''}
            title={option}
            onClick={shown ? undefined : () => setPicked(index)}
          />
        ))}
      </Card>
      {shown
        ? (
          <Banner tone={correct ? 'info' : 'warn'} title={correct ? 'Верно' : 'Неверно'}>
            {correct ? '' : ` Правильный ответ: ${question.options[question.correct]}. Вопрос вернётся в конец.`}
          </Banner>
        )
        : <Banner tone="info" title="Выберите один правильный вариант" />}
      {shown
        ? <button type="button" className="ov10-btn" onClick={next}>Далее</button>
        : (
          <button type="button" className="ov10-btn" disabled={picked === null} onClick={() => setShown(true)}>
            Ответить
          </button>
        )}
    </>
  );
}

function documentsTone(state: OperatorMobileState | null): Tone {
  if (!state) return '';
  const summary = documentsSummary(state.identity.documents);
  if (summary.blocking > 0) return 'bad';
  if (summary.expiring > 0) return 'warn';
  return 'ok';
}

const STEP_ICON: Record<string, string> = {
  PPE: 'safety', BRIEFING: 'doc', KNOWLEDGE: 'list', SIGNATURE: 'check', ADMISSION: 'shield',
};

const STEP_SCREEN: Record<'PPE' | 'BRIEFING' | 'KNOWLEDGE', string> = {
  PPE: 'ppe', BRIEFING: 'briefing', KNOWLEDGE: 'knowledge',
};

/* ------------------------------------------------------------ приложение --- */

export function OperatorV10App() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [safety, setSafety] = useState<SelfSafetyView | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('today');
  const [comment, setComment] = useState('');
  const [answers, setAnswers] = useState<Record<string, OperatorAnswer>>({});
  const [clock, setClock] = useState('');

  /**
   * Ключ команды переживает нажатие.
   *
   * На морозе в перчатке по кнопке попадают дважды. Ключ, созданный прямо в
   * обработчике, давал бы два разных ключа на два нажатия, и сервер записал бы
   * две команды. Новый ключ выдаётся только после удачной отправки.
   */
  const [commandId, setCommandId] = useState(newCommandId);

  const reload = useCallback(async () => {
    try {
      const coordinates = await currentPosition();
      const next = await fetchState({coordinates});
      setState(next);
      setLoadError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        window.location.href = '/login';
        return;
      }
      setState(null);
      setLoadError(cause instanceof Error ? cause.message : 'Не удалось получить состояние смены');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await reload(); })();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/safety/my-clearance', {
          cache: 'no-store', credentials: 'same-origin',
        });
        const payload = await response.json().catch(() => null) as
          (SelfSafetyView & {error?: string}) | null;
        if (!response.ok) throw new Error(payload?.error ?? 'Раздел ТБ недоступен');
        setSafety(payload as SelfSafetyView);
      } catch (cause) {
        setSafetyError(cause instanceof Error ? cause.message : 'Раздел ТБ недоступен');
      }
    })();
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = useCallback(async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setCommandId(newCommandId());
      setNotice(done);
      await reload();
    } catch (cause) {
      setNotice(cause instanceof QueuedOffline
        ? cause.message
        : cause instanceof Error ? cause.message : 'Действие не выполнено');
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const inspection = useMemo(
    () => state?.checklists.find((list) => list.stage === 'PRESHIFT_INSPECTION'),
    [state],
  );

  const accept = useCallback(() => {
    const equipmentId = state?.assignment?.equipmentId ?? state?.options[0]?.equipmentId;
    if (!equipmentId) {
      setNotice('Установка за вами не закреплена: технику назначает диспетчер.');
      return;
    }
    void run(() => sendCommand({
      command: 'accept-equipment', clientCommandId: commandId, equipmentId, shiftType: shiftType(),
    }), 'Установка принята.');
  }, [commandId, run, state]);

  /* Шаги допуска. Все три — строго онлайн: откладывать допуск в очередь значит
     пустить человека на площадку по записи, которой сервер ещё не видел. */
  const confirmPpe = useCallback((items: string[]) => {
    const day = state?.productionDate;
    if (!day) {
      setNotice('Производственные сутки не определены: обновите состояние.');
      return;
    }
    void run(() => sendCommand({command: 'confirm-ppe', productionDate: day, items}), 'СИЗ подтверждены.');
  }, [run, state]);

  const acknowledgeBriefing = useCallback(() => {
    void run(() => sendCommand({command: 'acknowledge-briefing'}), 'Ознакомление записано.');
  }, [run]);

  const submitKnowledge = useCallback(
    (picks: {questionId: string; picked: number}[], attemptToken: string) => {
      void run(() => sendCommand({command: 'submit-knowledge', attemptToken, picks}), 'Проверка знаний записана.');
    },
    [run],
  );

  /** Сдача осмотра: уходят ОТВЕТЫ ЧЕЛОВЕКА, а не «норма» по всем пунктам. */
  const submitInspection = useCallback(() => {
    const shiftId = state?.shift?.id;
    const equipmentId = state?.assignment?.equipmentId;
    if (!shiftId || !equipmentId || !inspection) {
      setNotice('Осмотр недоступен: сначала примите установку.');
      return;
    }
    const items = inspection.sections.flatMap((section) => section.items);
    const missing = items.filter((item) => !answers[item.id]);
    if (missing.length > 0) {
      setNotice(`Без ответа пунктов: ${missing.length}. Осмотр сдаётся целиком.`);
      return;
    }
    void run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: commandId,
      shiftId,
      equipmentId,
      stage: 'PRESHIFT_INSPECTION',
      answers: items.map((item) => ({itemId: item.id, answer: answers[item.id]})),
    }), 'Осмотр сдан.');
  }, [answers, commandId, inspection, run, state]);

  const closeShift = useCallback(() => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setNotice('Смена не начата: закрывать нечего.');
      return;
    }
    void run(() => sendCommand({command: 'close-shift', shiftId, comment}), 'Смена закрыта.');
  }, [comment, run, state]);

  const current = SCREENS.find((screen) => screen.id === active) ?? SCREENS[0];
  const activeTab = TABS.find((tab) => tab.screen === current.id)?.key ?? current.tab;

  /**
   * Поджать содержимое вместо прокрутки.
   *
   * Экран из шести строк, который приходится листать, раздражает сильнее, чем
   * шрифт на десятую меньше. Поэтому при небольшом перехлёсте плотность
   * подтягивается коэффициентом `--k` — до 0,82, дальше поджимать нельзя:
   * начинает страдать читаемость на морозе и в перчатке. Если и после этого не
   * помещается (осмотр на два десятка пунктов), остаётся прокрутка: прятать
   * пункты осмотра нельзя ни при каких обстоятельствах.
   *
   * Коэффициент ставится прямо на узел, а не в состояние: это подгонка вида, и
   * перерисовка ради неё не нужна.
   */
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = contentRef.current;
    if (!node) return undefined;
    const fit = () => {
      node.style.removeProperty('--k');
      const overflow = node.scrollHeight - node.clientHeight;
      if (overflow <= 1) return;
      const ratio = node.clientHeight / node.scrollHeight;
      node.style.setProperty('--k', Math.max(0.82, ratio).toFixed(3));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [active, state, safety, safetyError, answers, loading, notice, loadError, comment]);

  const body = (() => {
    if (loading) {
      return <><div className="ov10-skel" /><div className="ov10-skel short" /><div className="ov10-skel" /></>;
    }
    if (current.id === 'safety') return <ScreenSafety state={state} view={safety} error={safetyError} go={setActive} />;
    if (!state) {
      return (
        <Card>
          <Nodata>{loadError ?? 'Состояние смены недоступно'}</Nodata>
        </Card>
      );
    }
    switch (current.id) {
      case 'docs': return <ScreenDocs state={state} />;
      case 'more': return <ScreenMore state={state} go={setActive} />;
      case 'ppe': return <ScreenPpe state={state} busy={busy} onConfirm={confirmPpe} />;
      case 'briefing': return <ScreenBriefing state={state} busy={busy} onAcknowledge={acknowledgeBriefing} />;
      case 'knowledge': return <ScreenKnowledge busy={busy} onDone={submitKnowledge} />;
      case 'accept': return <ScreenAccept state={state} busy={busy} onAccept={accept} go={setActive} />;
      case 'inspect': return (
        <ScreenInspect
          checklist={inspection}
          answers={answers}
          onAnswer={(itemId, answer) => setAnswers((current2) => ({...current2, [itemId]: answer}))}
          go={setActive}
        />
      );
      case 'ready': return (
        <ScreenReady state={state} checklist={inspection} answers={answers} busy={busy}
          onSubmit={submitInspection} go={setActive} />
      );
      case 'work': return <ScreenWork state={state} go={setActive} />;
      case 'maint': return <ScreenMaint state={state} go={setActive} />;
      case 'closing': return (
        <ScreenClosing state={state} busy={busy} comment={comment} onComment={setComment} onClose={closeShift} />
      );
      case 'report': return <ScreenReport state={state} />;
      default: return <ScreenToday state={state} go={setActive} />;
    }
  })();

  return (
    <div className="ov10-screen">
      <div className="ov10-top">
        <StatusBar time={clock} />
        <Navbar
          title={current.title}
          onBack={current.id === 'today' ? undefined : () => setActive('today')}
          right={(
            <button type="button" className="iconbtn" onClick={() => void reload()} aria-label="Обновить">
              <Icon name="refresh" size={18} />
            </button>
          )}
        />
      </div>
      <div className="ov10-content" ref={contentRef}>
        {loadError && state ? <Banner tone="warn" title={loadError} /> : null}
        {notice ? <Banner tone="info" title={notice} /> : null}
        {!loading && !state && !loadError ? <Badge tone="warn">нет данных</Badge> : null}
        {body}
      </div>
      <Tabbar
        tabs={TABS}
        active={activeTab}
        onSelect={(key) => setActive(TABS.find((tab) => tab.key === key)?.screen ?? 'today')}
      />
    </div>
  );
}
