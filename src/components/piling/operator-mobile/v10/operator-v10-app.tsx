'use client';

import {OperatorWorkOverview, type WorkAction} from '../operator-work-overview';
import {useCallback, useEffect, useRef, useState} from 'react';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import type {
  ChecklistAnswer, ChecklistStage, DocumentVerdict, IncidentCategory, IncidentSign,
  OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS, INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SIGN_LABELS, INCIDENT_SIGNS,
  PPE_ITEMS, SAFETY_BRIEFING, TOPIC_LABELS,
} from '@/modules/operator-mobile/contracts';
import {ChecklistScreen} from '../screens/checklist-screen';
import {knownAnswers} from '../safety/known-answers';
import type {KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {admissionBlockers, admissionSteps} from '../safety/admission-steps';
import {documentsSummary} from '../safety/documents-summary';
import type {SelfSafetyView} from '@/modules/safety/application/self-clearance-query';
import {ApiError, QueuedOffline, currentPosition, fetchState, newCommandId, sendCommand} from '../api';
import {OfflineQueueBanner} from '../offline-queue-banner';
import {useOfflineQueue} from '../use-offline-queue';
import type {ProductionEntryInput} from '../api';
import {downtimeInterval, formatIntervalMinutes, hhmm} from '@/components/piling/operator-mobile/downtime-interval';
import {PilePassportForm} from '../screens/pile-passport-form';
import {formatNumber} from '@/lib/format';
import {
  Badge, Banner, Card, Icon, Metric, Navbar, Nodata, Pair, Row, Tabbar,
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
  {id: 'step', n: 4, title: 'Текущий шаг', short: 'Шаг', tab: 'today'},
  {id: 'work', n: 6, title: 'Работа', short: 'Работа', tab: 'today'},
  {id: 'maint', n: 7, title: 'Ежесменное обслуживание', short: 'Обслуживание', tab: 'equip'},
  {id: 'closing', n: 8, title: 'Закрытие смены', short: 'Закрытие', tab: 'more'},
  {id: 'report', n: 9, title: 'Отчёт и синхронизация', short: 'Отчёт', tab: 'more'},
  {id: 'safety', n: 10, title: 'ТБ и допуски', short: 'ТБ', tab: 'safety'},
  {id: 'ppe', n: 11, title: 'Средства защиты', short: 'СИЗ', tab: 'safety'},
  {id: 'briefing', n: 12, title: 'Ознакомление с инструкцией', short: 'Инструкция', tab: 'safety'},
  {id: 'knowledge', n: 13, title: 'Проверка знаний по ТБ', short: 'Знания', tab: 'safety'},
  {id: 'incidents', n: 15, title: 'Происшествия', short: 'ЧП', tab: 'safety'},
  {id: 'tb', n: 16, title: 'Чек-листы ТБ', short: 'ТБ по работам', tab: 'safety'},
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

/* ------------------------------------------------------ порядок смены --- */

type Phase = OperatorMobileState['phase'];

/**
 * Шаги смены — строго по порядку, который ведёт сервер (domain/shift-phases).
 *
 * ПОЧЕМУ ЛЕСТНИЦА, А НЕ ВКЛАДКИ (жалоба владельца 28.09.2026: «логика
 * вразброс, можно сразу закрыть смену»). Экран раньше давал открыть осмотр,
 * ЕО, работу и закрытие в любом порядке, а сервер отказывал — и человек не
 * понимал, что за чем. Теперь фаза сервера — единственный источник: сделанные
 * шаги отмечены, нажать можно только текущий, будущие закрыты до своей очереди.
 */
const STEPS: {phase: Phase; title: string}[] = [
  {phase: 'IDENTITY', title: 'Допуск: СИЗ, инструктаж, проверка знаний'},
  {phase: 'ADMISSION', title: 'Принять установку'},
  {phase: 'PRESHIFT_INSPECTION', title: 'Предсменный осмотр'},
  {phase: 'SITE_READY', title: 'Осмотр площадки'},
  {phase: 'STARTUP', title: 'Пуск и ЕО перед работой'},
  {phase: 'WORK', title: 'Работа: сваи, бурение, простой'},
  {phase: 'CLOSING', title: 'ЕО после работы и закрытие смены'},
];

/** Чек-лист, который закрывает фазу (тот же, что в domain/shift-phases). */
const PHASE_STAGE: Partial<Record<Phase, ChecklistStage>> = {
  PRESHIFT_INSPECTION: 'PRESHIFT_INSPECTION',
  SITE_READY: 'SITE_READY',
  STARTUP: 'EO_BEFORE',
  CLOSING: 'EO_AFTER',
};

/** Номер текущего шага; для закрытой смены — за последним. */
function stepIndex(phase: Phase): number {
  const index = STEPS.findIndex((step) => step.phase === phase);
  return index === -1 ? STEPS.length : index;
}

/**
 * Экран шага, до которого очередь ещё не дошла: вместо формы — что сделать
 * сначала и кнопка туда. Сервер такой шаг всё равно отверг бы.
 */
function NotYet({state, go}: {state: OperatorMobileState; go: Go}) {
  const current = STEPS[stepIndex(state.phase)];
  return (
    <>
      <Banner tone="warn" title="Этот шаг ещё не открыт" />
      <Card>
        <Row icon="check" tone="orange" title="Сначала" note={current ? current.title : 'Смена закрыта'} />
      </Card>
      {current ? (
        <button type="button" className="ov10-btn" onClick={() => go('step')}>
          Перейти: {current.title}
        </button>
      ) : null}
    </>
  );
}

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
      {/* Запрет показываем ПЕРВЫМ и отдельно от допуска.
          «Допуск получен» и «работа запрещена» — не одно и то же: корочки в
          порядке, а выработку писать нельзя. Пока этой карточки не было,
          человек узнавал о запрете только упёршись в отказ сервера на вводе. */}
      {!state.permit.allowed ? (
        <Card>
          <Row
            icon="shield"
            tone="bad"
            title="Работа запрещена"
            note={state.permit.blocks.map((block) => `${block.title}: ${block.detail}`).join(' · ')}
          />
          <Row
            icon="check"
            title="Что записывать можно"
            note="Простой, дефект, происшествие и отчёт — как обычно."
          />
        </Card>
      ) : null}
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
      <StepLadder state={state} go={go} />
    </>
  );
}

/**
 * Лестница смены: сделанное — галочкой, текущее — единственная активная
 * строка и большая кнопка «Дальше», будущее — закрыто до своей очереди.
 */
function StepLadder({state, go}: {state: OperatorMobileState; go: Go}) {
  const current = stepIndex(state.phase);
  const next = STEPS[current];
  return (
    <>
      {next ? (
        <button type="button" className="ov10-btn" onClick={() => go('step')}>
          Дальше: {next.title}
        </button>
      ) : <Banner tone="info" title="Смена закрыта" />}
      <Card title="Порядок смены">
        {STEPS.map((step, index) => {
          const done = index < current;
          const now = index === current;
          return (
            <Row
              key={step.phase}
              icon={done ? 'check' : now ? 'work' : 'list'}
              tone={done ? 'ok' : now ? 'orange' : ''}
              title={`${index + 1}. ${step.title}`}
              note={done ? 'выполнено' : now ? 'сейчас' : 'откроется после предыдущего шага'}
              chevron={now}
              onClick={now ? () => go('step') : undefined}
            />
          );
        })}
      </Card>
    </>
  );
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
      <button type="button" className="ov10-btn ghost" onClick={() => go('today')}>К порядку смены</button>
    </>
  );
}

/**
 * Запись выработки прямо здесь (решение владельца 18.09.2026).
 *
 * Раньше на этом месте стояла плашка «формы живут на Смене машиниста» — то
 * есть модуль предлагал машинисту уйти в ДРУГОЙ модуль, чтобы записать сваю.
 * Модуль, из которого нельзя записать выработку, рабочим местом не является.
 *
 * Поля те же, что и в рабочем экране /operator, и уходят той же командой
 * log-production: сервер один, и правила приёмки записи тоже одни.
 */
function ProductionForm({state, busy, onLog, initialKind = 'PILES', downtimeOnly = false}: {
  initialKind?: WorkAction;
  state: OperatorMobileState;
  busy: boolean;
  /** true — сервер принял запись (или она легла в очередь); только тогда форма очищается. */
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
  /** После «Завершить работу» сервер принимает только простой — и форма предлагает только его. */
  downtimeOnly?: boolean;
}) {
  const [kind, setKind] = useState<WorkAction>(downtimeOnly ? 'DOWNTIME' : initialKind);
  const [optionId, setOptionId] = useState('');
  const [count, setCount] = useState('');
  const [meters, setMeters] = useState('');
  const [startedHm, setStartedHm] = useState('');
  const [endedHm, setEndedHm] = useState('');


  const options = kind === 'PILES' || kind === 'PASSPORT' ? state.dictionaries.pileGrades
    : kind === 'DRILLING' ? state.dictionaries.drillingTypes
      : state.dictionaries.downtimeReasons;

  const switchKind = (next: typeof kind) => {
    setKind(next);
    setOptionId('');
    setCount('');
    setMeters('');
    setStartedHm('');
    setEndedHm('');
  };

  const amount = Number(count.replace(',', '.'));
  const perUnit = Number(meters.replace(',', '.'));
  // Простой задаётся интервалом: подпись под полями и то, что уйдёт на
  // сервер, — одна и та же величина (см. downtime-interval).
  const interval = kind === 'DOWNTIME' ? downtimeInterval(startedHm, endedHm) : null;
  // Запрет закрывает выработку и не трогает простой — domain/production-permit.ts.
  const forbidden = kind !== 'DOWNTIME' && !state.permit.allowed;
  const ready = !forbidden && optionId !== '' && (
    kind === 'DOWNTIME'
      ? interval !== null
      : Number.isFinite(amount) && amount > 0
        && (kind !== 'DRILLING' || (Number.isFinite(perUnit) && perUnit > 0))
  );

  // Поля очищаются только по успеху: при отказе сервера («простой раньше
  // начала смены», «пересекается с записанным») введённое остаётся на экране
  // рядом с причиной отказа, а не исчезает молча (жалоба 28.09.2026:
  // «простой не записывается»).
  const submit = async () => {
    if (!ready) return;
    let accepted = false;
    if (kind === 'PILES') accepted = await onLog({kind: 'PILES', pileGradeId: optionId, count: Math.round(amount)});
    else if (kind === 'DRILLING') {
      accepted = await onLog({kind: 'DRILLING', typeId: optionId, count: Math.round(amount), metersPerUnit: perUnit});
    } else if (interval) {
      accepted = await onLog({
        kind: 'DOWNTIME', reasonId: optionId,
        startedAt: interval.startedAt, endedAt: interval.endedAt,
      });
    }
    if (!accepted) return;
    setOptionId('');
    setCount('');
    setMeters('');
    setStartedHm('');
    setEndedHm('');
  };

  return (
    <Card title="Записать выработку">
      {downtimeOnly ? (
        <p className="ov10-hint">Работа завершена: сваи и бурение больше не записываются, простой — можно.</p>
      ) : (
      <div className="ov10-chips on-work">
        <button type="button" className={kind === 'PILES' ? 'on' : ''}
          aria-pressed={kind === 'PILES'} onClick={() => switchKind('PILES')}>Свая</button>
        <button type="button" className={kind === 'PASSPORT' ? 'on' : ''}
          aria-pressed={kind === 'PASSPORT'} onClick={() => switchKind('PASSPORT')}>Паспорт</button>
        <button type="button" className={kind === 'DRILLING' ? 'on' : ''}
          aria-pressed={kind === 'DRILLING'} onClick={() => switchKind('DRILLING')}>Бурение</button>
        <button type="button" className={kind === 'DOWNTIME' ? 'on' : ''}
          aria-pressed={kind === 'DOWNTIME'} onClick={() => switchKind('DOWNTIME')}>Простой</button>
      </div>
      )}

      {/* Паспорт — журнал забивки на одну сваю по СП 45.13330: номер, залоги,
          отказ, отметки головы. Форма общая со всеми модулями: требование к
          ней нормативное, и расходиться ей нельзя. */}
      {kind === 'PASSPORT' ? (
        <PilePassportForm
          grades={state.dictionaries.pileGrades}
          busy={busy}
          onSubmit={(pileGradeId, passport) => onLog({kind: 'PILE_PASSPORT', pileGradeId, passport})}
        />
      ) : (
      <>
      <label className="ov10-field">
        <span className="lab">
          {kind === 'PILES' ? 'Марка сваи' : kind === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
        </span>
        <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
          <option value="">Выберите…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </label>

      {forbidden ? (
        <p className="ov10-hint">
          Работа запрещена: {state.permit.blocks.map((block) => block.title).join('; ')}.
          Простой записывается как обычно.
        </p>
      ) : null}

      {kind === 'DOWNTIME' ? (
        <>
          <label className="ov10-field">
            <span className="lab">Простой начался</span>
            <input type="time" value={startedHm}
              onChange={(event) => setStartedHm(event.target.value)} />
          </label>
          <label className="ov10-field">
            <span className="lab">Закончился</span>
            <input type="time" value={endedHm}
              onChange={(event) => setEndedHm(event.target.value)} />
          </label>
          <button type="button" className="ov10-rowbtn"
            onClick={() => setEndedHm(hhmm(new Date()))}>Закончился сейчас</button>
          {interval ? (
            <p className="ov10-hint">Простой: {formatIntervalMinutes(interval.minutes)}</p>
          ) : null}
        </>
      ) : (
        <label className="ov10-field">
          <span className="lab">Количество, шт</span>
          <input inputMode="decimal" value={count}
            onChange={(event) => setCount(event.target.value)} />
        </label>
      )}

      {kind === 'DRILLING' ? (
        <label className="ov10-field">
          <span className="lab">Метров на скважину</span>
          <input inputMode="decimal" value={meters}
            onChange={(event) => setMeters(event.target.value)} />
        </label>
      ) : null}

      <button type="button" className="ov10-btn" style={{marginTop: 12}}
        disabled={busy || !ready} onClick={() => void submit()}>
        {busy ? 'Записываем…' : 'Записать'}
      </button>
      </>
      )}
    </Card>
  );
}

function ScreenWork({state, busy, onLog, go}: {
  state: OperatorMobileState;
  busy: boolean;
  onLog: (entry: ProductionEntryInput) => Promise<boolean>;
  go: Go;
}) {
  const [entry, setEntry] = useState<WorkAction | null>(null);
  // До своей очереди работа не открывается: сервер отверг бы любую запись.
  if (stepIndex(state.phase) < stepIndex('WORK')) return <NotYet state={state} go={go} />;
  // После «Завершить работу» — только простой: последний отрезок остановки
  // обычно вносят уже при сдаче.
  if (state.phase !== 'WORK') {
    return (
      <>
        <ProductionForm state={state} busy={busy} onLog={onLog} downtimeOnly />
        <button type="button" className="ov10-btn ghost" onClick={() => go('step')}>К ЕО после работы и закрытию</button>
      </>
    );
  }
  if (entry) return <><button type="button" className="oc-form-back" onClick={()=>setEntry(null)}>← К смене</button><ProductionForm key={entry} state={state} busy={busy} onLog={onLog} initialKind={entry} /></>;
  return <OperatorWorkOverview state={state} variant="v10" busy={busy} onAction={setEntry}
    onIncident={()=>go('incidents')} onFinish={()=>go('closing')} />;
}

/**
 * Техника: чек-листы смены и открытые неисправности.
 *
 * ЕО проходят здесь же (решение владельца 18.09.2026), но ПО ОЧЕРЕДИ (жалоба
 * 28.09.2026 «вразброс»): раньше экран раскладывал сразу все четыре списка,
 * и человек отвечал на ЕО после работы, не пройдя осмотр, — сервер отказывал.
 * Теперь сданное отмечено, текущий список открывается кнопкой, будущие закрыты.
 */
function ScreenMaint({state, go}: {state: OperatorMobileState; go: Go}) {
  const currentStage = PHASE_STAGE[state.phase];
  const lists = state.checklists.filter((list) => list.stage !== 'TB_PILING'
    && list.stage !== 'TB_DRILLING');
  return (
    <>
      <Card title="Чек-листы смены">
        {lists.length === 0
          ? <Nodata>Чек-листы станут доступны после приёма установки</Nodata>
          : lists.map((list) => {
            const items = list.sections.flatMap((section) => section.items).length;
            if (list.done) {
              return <Row key={list.stage} icon="wrench" tone="ok" title={list.title} note={`сдано · ${items} пунктов`} />;
            }
            if (list.stage === currentStage) {
              return (
                <Row key={list.stage} icon="wrench" tone="orange" title={list.title}
                  note="сейчас — нажмите, чтобы пройти" chevron onClick={() => go('step')} />
              );
            }
            return <Row key={list.stage} icon="list" tone="" title={list.title} note="откроется в свою очередь" />;
          })}
      </Card>
      <Card title="Открытые неисправности">
        {state.defects.length === 0
          ? <Nodata>Открытых неисправностей нет</Nodata>
          : state.defects.map((defect) => (
            <Row key={defect.id} icon="warning" tone="warn" title={defect.title}
              note={`${defect.reportedByMe ? 'записали вы' : defect.reportedByName} · ${dateRu(defect.reportedAt)}`} />
          ))}
      </Card>
      <button type="button" className="ov10-btn ghost" onClick={() => go('today')}>К порядку смены</button>
    </>
  );
}

/**
 * Строка ТБ в разделе допуска: срок ближайшего периодического чек-листа.
 *
 * Показываем худшее из двух: просроченный важнее того, у которого запас три
 * месяца. Человеку нужен один ответ — надо ли идти проходить.
 */
function tbTone(state: OperatorMobileState | null): Tone {
  const lists = state?.checklists.filter((list) => list.period !== null) ?? [];
  if (lists.some((list) => list.period?.due)) return 'bad';
  if (lists.some((list) => list.period?.warn)) return 'warn';
  return 'ok';
}

function tbNote(state: OperatorMobileState | null): string {
  const lists = state?.checklists.filter((list) => list.period !== null) ?? [];
  if (lists.length === 0) return 'нет доступных списков';
  const due = lists.filter((list) => list.period?.due);
  if (due.length > 0) return `подошёл срок: ${due.map((list) => list.title).join(', ')}`;
  const soon = lists
    .map((list) => list.period?.daysLeft)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)[0];
  return soon === undefined ? 'сроки не определены' : `ближайший срок через ${soon} дн.`;
}

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
function ScreenSafetyChecklists({state, busy, error, commandId, onSubmit, go}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  commandId: string;
  onSubmit: (stage: ChecklistStage, answers: ChecklistAnswer[]) => Promise<boolean>;
  go: Go;
}) {
  const [open, setOpen] = useState<ChecklistStage | null>(null);
  const lists = state.checklists.filter((list) => list.period !== null);
  const opened = open ? lists.find((list) => list.stage === open) : undefined;
  if (opened) {
    return (
      <ChecklistScreen
        key={opened.stage}
        checklist={opened}
        warnings={state.warnings}
        busy={busy}
        error={error}
        commandId={commandId}
        lastMeter={state.assignment?.lastMeter ?? null}
        known={knownAnswers(opened.stage, state)}
        onBack={() => setOpen(null)}
        onSubmit={(answers) => {
          void onSubmit(opened.stage, answers).then((ok) => { if (ok) setOpen(null); });
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
function ScreenClosing({state, busy, onFinish, onClose, go}: {
  state: OperatorMobileState;
  busy: boolean;
  /** «Завершить работу» — сервер переводит смену в сдачу (finish-work). */
  onFinish: () => void;
  onClose: () => void;
  go: Go;
}) {
  const {assignment} = state;
  const [confirmFinish, setConfirmFinish] = useState(false);
  // До работы закрывать нечего: закрытие открывается в свою очередь, а не с
  // первой минуты смены (жалоба 28.09.2026 «можно сразу закрыть смену»).
  if (stepIndex(state.phase) < stepIndex('WORK')) return <NotYet state={state} go={go} />;

  /*
   * ЗАВЕРШИТЬ РАБОТУ — ОТДЕЛЬНЫМ ДЕЙСТВИЕМ С ПОДТВЕРЖДЕНИЕМ.
   *
   * Раньше кнопка на экране работы только открывала этот экран: на сервер
   * «работа завершена» не уходило вовсе, и смена оставалась в работе.
   * После завершения сваи и бурение больше не принимаются — поэтому второе
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
        <Banner tone="warn" title="После «Завершить работу» сваи и бурение записать будет нельзя">
          {' '}— только простой. Дальше: ЕО после работы и закрытие смены.
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
            <button type="button" className="ov10-btn ghost" onClick={() => go('work')}>К записи выработки</button>
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
      {closed ? <Banner tone="info" title="Смена закрыта" /> : null}
      {!closed && !afterDone ? (
        <>
          <Banner tone="warn" title="Сначала ЕО после работы" />
          <button type="button" className="ov10-btn green" onClick={() => go('step')}>
            Пройти ЕО после работы
          </button>
        </>
      ) : null}
      {!closed && afterDone ? (
        <button type="button" className="ov10-btn orange" disabled={busy} onClick={onClose}>
          {busy ? 'Закрываем…' : 'Закрыть смену и отправить отчёт'}
        </button>
      ) : null}
      {!closed ? (
        <button type="button" className="ov10-btn ghost" onClick={() => go('work')}>Записать простой</button>
      ) : null}
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
        <Metric label="Простой" value={formatDowntimeHours(state.production.downtimeHours)} />
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


/**
 * Происшествия смены: журнал и запись нового.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ НЕИСПРАВНОСТИ. Неисправность — про машину, её чинит
 * механик. Происшествие — про смену: человек ушибся, посторонний зашёл в
 * опасную зону, разлили масло. Его не чинят, его разбирают, поэтому место ему
 * здесь, в разделе ТБ, а не в карточке техники.
 *
 * ПОЧЕМУ ЗАПИСЬ НИЧЕГО НЕ ЗАПИРАЕТ. Правило по признакам само решает,
 * насколько это опасно, и может сказать «работы прекращают». Но прекращает их
 * человек: приложение не видит площадку и не знает, чем обернётся остановка
 * посреди погружения сваи.
 */
function ScreenIncidents({state, busy, onReport}: {
  state: OperatorMobileState;
  busy: boolean;
  onReport: (input: {
    category: IncidentCategory; signs: IncidentSign[]; injured: boolean; description: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<IncidentCategory | ''>('');
  const [signs, setSigns] = useState<IncidentSign[]>([]);
  const [injured, setInjured] = useState(false);
  const [description, setDescription] = useState('');

  const ready = category !== '' && signs.length > 0
    && description.trim().length >= INCIDENT_DESCRIPTION_MIN;

  const toggle = (sign: IncidentSign) => setSigns((current) => (
    current.includes(sign) ? current.filter((item) => item !== sign) : [...current, sign]
  ));

  return (
    <>
      <Card title="Происшествия смены">
        {state.incidents.length === 0
          ? <Nodata>Происшествий не записано</Nodata>
          : state.incidents.map((incident) => (
            <Row
              key={incident.id}
              icon="warn"
              tone={incident.reviewedAt ? 'ok' : 'warn'}
              title={INCIDENT_CATEGORY_LABELS[incident.category]}
              note={`${timeRu(incident.occurredAt)} · ${incident.description}`}
            />
          ))}
      </Card>

      {!open ? (
        <button type="button" className="ov10-btn ghost" onClick={() => setOpen(true)}>
          Записать происшествие
        </button>
      ) : (
        <Card title="Что произошло">
          <label className="ov10-field">
            <span className="lab">Событие</span>
            <select value={category}
              onChange={(event) => setCategory(event.target.value as IncidentCategory)}>
              <option value="">Выберите…</option>
              {INCIDENT_CATEGORIES.map((item) => (
                <option key={item} value={item}>{INCIDENT_CATEGORY_LABELS[item]}</option>
              ))}
            </select>
          </label>

          {/* Хотя бы один признак обязателен: по ним правило решает, насколько
              это опасно. Без них запись не говорит, надо ли бежать. */}
          <div className="ov10-chips wrap">
            {INCIDENT_SIGNS.map((sign) => (
              <button
                key={sign}
                type="button"
                className={signs.includes(sign) ? 'on' : ''}
                aria-pressed={signs.includes(sign)}
                onClick={() => toggle(sign)}
              >
                {INCIDENT_SIGN_LABELS[sign]}
              </button>
            ))}
          </div>

          <div className="ov10-chips">
            <button type="button" className={injured ? 'on' : ''} aria-pressed={injured}
              onClick={() => setInjured(true)}>Есть пострадавшие</button>
            <button type="button" className={injured ? '' : 'on'} aria-pressed={!injured}
              onClick={() => setInjured(false)}>Пострадавших нет</button>
          </div>

          <label className="ov10-field">
            <span className="lab">Как было дело</span>
            <textarea rows={4} value={description} maxLength={4000}
              onChange={(event) => setDescription(event.target.value)} />
          </label>

          <button
            type="button"
            className="ov10-btn"
            style={{marginTop: 12}}
            disabled={busy || !ready}
            onClick={() => {
              if (!ready) return;
              onReport({category, signs, injured, description: description.trim()});
              setOpen(false);
              setCategory('');
              setSigns([]);
              setInjured(false);
              setDescription('');
            }}
          >
            {busy ? 'Записываем…'
              : ready ? 'Записать происшествие'
                : `Опишите подробнее — не меньше ${INCIDENT_DESCRIPTION_MIN} знаков`}
          </button>
        </Card>
      )}
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

/**
 * СИЗ: отмечают ОТСУТСТВИЕ, нехватка записывается как есть и не запирает экран.
 *
 * ПОЧЕМУ ГАЛОЧКИ СТОЯТ ЗАРАНЕЕ. У работника, вышедшего на смену, комплект
 * обычно полон, и шесть обязательных нажатий в шесть утра превращаются в
 * шесть нажатий не глядя. Снимать отметку человек будет осознанно.
 *
 * ПОЧЕМУ ПОДПИСЬ ПЕРЕПИСАНА. Стояло «Отметьте то, что у вас есть» — при уже
 * расставленных галочках это читается как «пройдитесь по списку», и человек,
 * добросовестно нажав на каждую строку, СНИМАЛ весь комплект. Подтверждение
 * уходило с пометкой «не хватает каски». Экран должен просить то, что делает.
 */
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
      <Card title="Комплект отмечен полностью — снимите отметку с того, чего нет">
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
          {' '}Запишем как есть. Пока не получите недостающее, выработку записать
          нельзя — простой и происшествия записываются как обычно.
        </Banner>
      ) : null}
      <button type="button" className="ov10-btn" disabled={busy} onClick={() => onConfirm(items)}>
        {busy ? 'Записываем…'
          : missing.length === 0 ? 'Комплект в порядке'
            : `Подтвердить (нет: ${missing.length})`}
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
  /**
   * Отказ сервера — отдельно от «Записано» и заметно. Раньше оба жили в одной
   * голубой полосе вверху страницы: машинист, прокрутивший форму вниз, отказа
   * не видел — «простой не записывается», «ЕО ничего не делает» (28.09.2026).
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('today');
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Новое сообщение — к нему: полоса вверху, форма могла быть прокручена вниз.
  useEffect(() => {
    if (notice || actionError) contentRef.current?.scrollIntoView({block: 'start', behavior: 'smooth'});
  }, [notice, actionError]);

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
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- намеренно: сессия истекла, полная перезагрузка сбрасывает кэш маршрутов и память вкладки прежнего входа
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

  /** true — сервер принял (или запись легла в очередь); формы очищаются только по нему. */
  const run = useCallback(async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    setActionError(null);
    try {
      await fn();
      setCommandId(newCommandId());
      setNotice(done);
      await reload();
      return true;
    } catch (cause) {
      // Запись легла в очередь — это принятая запись, а не отказ: следующая
      // обязана получить новый ключ. Со старым ключом очередь считала её
      // повтором той же записи и молча не брала, а сервер — тем более.
      if (cause instanceof QueuedOffline) {
        setCommandId(newCommandId());
        setNotice(cause.message);
        return true;
      }
      setActionError(cause instanceof Error ? cause.message : 'Действие не выполнено');
      // 409 — сервер уже в другом состоянии: перечитываем, чтобы экран не спорил.
      if (cause instanceof ApiError && cause.status === 409) void reload();
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const {queued, retry: retryQueued, discard: discardQueued} = useOfflineQueue(reload);


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

  const reportIncident = useCallback((input: {
    category: IncidentCategory; signs: IncidentSign[]; injured: boolean; description: string;
  }) => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setNotice('Смена не открыта: записать происшествие некуда.');
      return;
    }
    void run(() => sendCommand({
      command: 'report-incident', clientCommandId: commandId, shiftId, ...input,
    }), 'Происшествие записано.');
  }, [commandId, run, state]);

  /**
   * Сдача чек-листа: ответы собирает общий экран (описание замечаний, фото,
   * замеры), здесь только отправка. Успех возвращается, чтобы экран шага
   * вернул человека к порядку смены, а не оставлял на сданном списке.
   */
  const submitChecklist = useCallback(async (stage: ChecklistStage, checklistAnswers: ChecklistAnswer[]): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    const equipmentId = state?.assignment?.equipmentId;
    const list = state?.checklists.find((item) => item.stage === stage);
    if (!shiftId || !equipmentId || !list) {
      setActionError('Список недоступен: сначала примите установку.');
      return false;
    }
    return run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: commandId,
      shiftId,
      equipmentId,
      stage,
      answers: checklistAnswers,
    }), list.title + ': сдано.');
  }, [commandId, run, state]);

  const logProduction = useCallback(async (entry: ProductionEntryInput): Promise<boolean> => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: записывать некуда.');
      return false;
    }
    return run(
      () => sendCommand({command: 'log-production', clientCommandId: commandId, shiftId, entry}),
      'Записано.',
    );
  }, [commandId, run, state]);

  /** Работа закончена: сервер переводит смену в сдачу, дальше ЕО после работы. */
  const finishWork = useCallback(() => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: завершать нечего.');
      return;
    }
    void run(() => sendCommand({command: 'finish-work', shiftId}), 'Работа завершена. Дальше — ЕО после работы.')
      .then((ok) => { if (ok) setActive('step'); });
  }, [run, state]);

  const closeShift = useCallback(() => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setActionError('Смена не начата: закрывать нечего.');
      return;
    }
    void run(() => sendCommand({command: 'close-shift', shiftId, comment: ''}), 'Смена закрыта.');
  }, [run, state]);

  /**
   * Экран текущего шага — по фазе сервера. Одна точка входа вместо
   * разбросанных «осмотр», «готовность», «обслуживание», «закрытие».
   */
  const stepScreen = (current: OperatorMobileState) => {
    const stage = current.phase === 'CLOSING'
      && current.checklists.some((list) => list.stage === 'EO_AFTER' && list.done)
      ? undefined
      : PHASE_STAGE[current.phase];
    const list = stage ? current.checklists.find((item) => item.stage === stage) : undefined;
    if (current.phase === 'IDENTITY') {
      return <ScreenSafety state={current} view={safety} error={safetyError} go={setActive} />;
    }
    if (current.phase === 'ADMISSION') {
      return <ScreenAccept state={current} busy={busy} onAccept={accept} go={setActive} />;
    }
    if (stage) {
      if (!list) return <Card><Nodata>Список «{stage}» не пришёл с сервера — обновите экран</Nodata></Card>;
      return (
        <ChecklistScreen
          key={list.stage}
          checklist={list}
          warnings={current.warnings}
          busy={busy}
          error={actionError}
          commandId={commandId}
          lastMeter={current.assignment?.lastMeter ?? null}
          known={knownAnswers(list.stage, current)}
          onBack={() => setActive('today')}
          onSubmit={(checklistAnswers) => {
            void submitChecklist(list.stage, checklistAnswers).then((ok) => {
              if (ok) setActive(list.stage === 'EO_AFTER' ? 'closing' : 'today');
            });
          }}
        />
      );
    }
    if (current.phase === 'WORK') return <ScreenWork state={current} busy={busy} onLog={logProduction} go={setActive} />;
    return <ScreenClosing state={current} busy={busy} onFinish={finishWork} onClose={closeShift} go={setActive} />;
  };

  const current = SCREENS.find((screen) => screen.id === active) ?? SCREENS[0];
  const activeTab = TABS.find((tab) => tab.screen === current.id)?.key ?? current.tab;

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
      case 'incidents': return <ScreenIncidents state={state} busy={busy} onReport={reportIncident} />;
      case 'tb': return (
        <ScreenSafetyChecklists state={state} busy={busy} error={actionError} commandId={commandId}
          onSubmit={submitChecklist} go={setActive} />
      );
      case 'accept': return <ScreenAccept state={state} busy={busy} onAccept={accept} go={setActive} />;
      case 'step': return stepScreen(state);
      case 'work': return (
        <ScreenWork state={state} busy={busy} onLog={logProduction} go={setActive} />
      );
      case 'maint': return <ScreenMaint state={state} go={setActive} />;
      case 'closing': return (
        <ScreenClosing state={state} busy={busy} onFinish={finishWork} onClose={closeShift} go={setActive} />
      );
      case 'report': return <ScreenReport state={state} />;
      // «Смена» — всегда лестница шагов: что сделано, что сейчас, что дальше.
      default: return <ScreenToday state={state} go={setActive} />;
    }
  })();

  return (
    <div className="ov10-screen">
      <div className="ov10-top">
        <Navbar
          title={current.id === 'step' && state ? (STEPS[stepIndex(state.phase)]?.title ?? 'Смена закрыта') : current.title}
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
        {actionError ? <Banner tone="bad" title={`Не записано: ${actionError}`} /> : null}
        {notice ? <Banner tone="info" title={notice} /> : null}
        <OfflineQueueBanner items={queued} onRetry={retryQueued} onDiscard={discardQueued} className="space-y-1" />
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
