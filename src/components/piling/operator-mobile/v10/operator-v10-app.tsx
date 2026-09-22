'use client';

import {OperatorWorkOverview, type WorkAction} from '../operator-work-overview';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import type {
  ChecklistStage, ChecklistView, DocumentVerdict, IncidentCategory, IncidentSign,
  OperatorAnswer, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS, INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SIGN_LABELS, INCIDENT_SIGNS,
  PPE_ITEMS, SAFETY_BRIEFING, TOPIC_LABELS, measureRequired,
} from '@/modules/operator-mobile/contracts';
import type {KnowledgeQuestion} from '@/modules/operator-mobile/contracts';
import {admissionBlockers, admissionSteps} from '../safety/admission-steps';
import {documentsSummary} from '../safety/documents-summary';
import type {SelfSafetyView} from '@/modules/safety/application/self-clearance-query';
import {ApiError, QueuedOffline, currentPosition, fetchState, newCommandId, sendCommand} from '../api';
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
/** Пункты чек-листа с ответами. Одна разметка на осмотр и на ЕО. */
function ChecklistItems({checklist, answers, measures, onAnswer, onMeasure}: {
  checklist: ChecklistView;
  answers: Record<string, OperatorAnswer>;
  measures: Record<string, string>;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  onMeasure: (key: string, value: string) => void;
}) {
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
              {item.measure && measureRequired(item, answers[item.id] ?? 'OK') ? (
                <label className="ov10-field">
                  <span className="lab">
                    {item.measure.label}, {item.measure.unit}
                    {item.measure.max !== undefined
                      ? ` (от ${item.measure.min ?? 0} до ${item.measure.max})`
                      : ''}
                  </span>
                  <input
                    inputMode="decimal"
                    value={measures[item.measure.key] ?? ''}
                    onChange={(event) => onMeasure(item.measure?.key ?? '', event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}

function ScreenInspect({checklist, answers, measures, onAnswer, onMeasure, go}: {
  checklist: ChecklistView | undefined;
  answers: Record<string, OperatorAnswer>;
  measures: Record<string, string>;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  onMeasure: (key: string, value: string) => void;
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
      <ChecklistItems checklist={checklist} answers={answers} measures={measures}
        onAnswer={onAnswer} onMeasure={onMeasure} />
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
function ProductionForm({state, busy, onLog, initialKind = 'PILES'}: {
  initialKind?: WorkAction;
  state: OperatorMobileState;
  busy: boolean;
  onLog: (entry: ProductionEntryInput) => void;
}) {
  const [kind, setKind] = useState<WorkAction>(initialKind);
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

  const submit = () => {
    if (!ready) return;
    if (kind === 'PILES') onLog({kind: 'PILES', pileGradeId: optionId, count: Math.round(amount)});
    else if (kind === 'DRILLING') {
      onLog({kind: 'DRILLING', typeId: optionId, count: Math.round(amount), metersPerUnit: perUnit});
    } else if (interval) {
      onLog({
        kind: 'DOWNTIME', reasonId: optionId,
        startedAt: interval.startedAt, endedAt: interval.endedAt,
      });
    }
    setOptionId('');
    setCount('');
    setMeters('');
    setStartedHm('');
    setEndedHm('');
  };

  return (
    <Card title="Записать выработку">
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

      {/* Паспорт — журнал забивки на одну сваю по СП 45.13330: номер, залоги,
          отказ, отметки головы. Форма общая со всеми модулями: требование к
          ней нормативное, и расходиться ей нельзя. */}
      {kind === 'PASSPORT' ? (
        <PilePassportForm
          grades={state.dictionaries.pileGrades}
          busy={busy}
          onSubmit={async (pileGradeId, passport) => {
            onLog({kind: 'PILE_PASSPORT', pileGradeId, passport});
            return true;
          }}
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
        disabled={busy || !ready} onClick={submit}>
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
  onLog: (entry: ProductionEntryInput) => void;
  go: Go;
}) {
  const [entry, setEntry] = useState<WorkAction | null>(null);
  if (entry) return <><button type="button" className="oc-form-back" onClick={()=>setEntry(null)}>← К смене</button><ProductionForm key={entry} state={state} busy={busy} onLog={onLog} initialKind={entry} /></>;
  return <OperatorWorkOverview state={state} variant="v10" busy={busy} onAction={setEntry}
    onIncident={()=>go('incidents')} onFinish={()=>go('closing')} />;
}

/**
 * ЕО здесь ПРОХОДЯТ, а не читают (решение владельца 18.09.2026).
 *
 * Экран показывал «Не отмечено» и не давал ответить ни на один пункт. Сервер
 * при этом не закрывает смену без ЕО после работы — поэтому смену, начатую в
 * v10, закрыть было нельзя вовсе. Это и была жалоба «не могу закрыть смену».
 */
function ScreenMaint({state, answers, measures, busy, onAnswer, onMeasure, onSubmit, go}: {
  state: OperatorMobileState;
  answers: Record<string, OperatorAnswer>;
  measures: Record<string, string>;
  busy: boolean;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  onMeasure: (key: string, value: string) => void;
  onSubmit: (stage: ChecklistStage) => void;
  go: Go;
}) {
  // ВСЕ списки смены, а не только ЕО. Раньше здесь были два чек-листа из
  // четырёх, и «Готовность площадки» пройти было негде: сервер не закрывал
  // смену, а экрана под неё в модуле не существовало.
  const lists = state.checklists.filter((list) => list.stage !== 'TB_PILING'
    && list.stage !== 'TB_DRILLING');
  return (
    <>
      {lists.length === 0
        ? <Card><Nodata>Чек-листы обслуживания недоступны</Nodata></Card>
        : lists.map((list) => {
          const items = list.sections.flatMap((section) => section.items);
          const left = items.filter((item) => !answers[item.id]).length;
          if (list.done) {
            return (
              <Card key={list.stage} title={list.title}>
                <Row icon="wrench" tone="ok" title="Выполнено"
                  note={`${items.length} пунктов · версия ${list.version}`} />
              </Card>
            );
          }
          return (
            <div key={list.stage}>
              <Card title={list.title}>
                <Row icon="wrench" tone="warn" title="Не отмечено"
                  note={`${items.length} пунктов · версия ${list.version}`} />
              </Card>
              <ChecklistItems checklist={list} answers={answers} measures={measures}
                onAnswer={onAnswer} onMeasure={onMeasure} />
              <button type="button" className="ov10-btn green" disabled={busy || left > 0}
                onClick={() => onSubmit(list.stage)}>
                {busy ? 'Отправляем…' : left > 0 ? `Осталось ответить: ${left}` : 'Сдать ' + list.title}
              </button>
            </div>
          );
        })}
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
function ScreenSafetyChecklists({state, answers, measures, busy, onAnswer, onMeasure, onSubmit, go}: {
  state: OperatorMobileState;
  answers: Record<string, OperatorAnswer>;
  measures: Record<string, string>;
  busy: boolean;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  onMeasure: (key: string, value: string) => void;
  onSubmit: (stage: ChecklistStage) => void;
  go: Go;
}) {
  const lists = state.checklists.filter((list) => list.period !== null);
  return (
    <>
      {lists.length === 0
        ? <Card><Nodata>Чек-листы ТБ недоступны</Nodata></Card>
        : lists.map((list) => {
          const items = list.sections.flatMap((section) => section.items);
          const left = items.filter((item) => !answers[item.id]).length;
          const period = list.period;
          const due = period?.due ?? false;
          const warn = period?.warn ?? false;
          return (
            <div key={list.stage}>
              <Card title={list.title}>
                <Row
                  icon="safety"
                  tone={due ? 'bad' : warn ? 'warn' : 'ok'}
                  title={due ? 'Срок подошёл'
                    : warn ? `Срок через ${period?.daysLeft} дн.`
                      : 'Действует'}
                  note={due
                    ? 'без него запись выработки не примут'
                    : `до ${dateRu(period?.validUntil)} · ${items.length} пунктов`}
                />
              </Card>
              {/* Пройти заранее — законное действие, за которое не наказывают:
                  список открыт и когда срок ещё не вышел. */}
              <ChecklistItems checklist={list} answers={answers} measures={measures}
                onAnswer={onAnswer} onMeasure={onMeasure} />
              <button type="button" className="ov10-btn green" disabled={busy || left > 0}
                onClick={() => onSubmit(list.stage)}>
                {busy ? 'Отправляем…' : left > 0 ? `Осталось ответить: ${left}` : 'Сдать ' + list.title}
              </button>
            </div>
          );
        })}
      <button type="button" className="ov10-btn ghost" onClick={() => go('safety')}>К разделу ТБ</button>
    </>
  );
}

/**
 * Закрытие смены. Поля комментария здесь нет (решение владельца 18.09.2026):
 * то, что надо передать следующей смене, — это передача машины, отдельное
 * действие со своим адресатом, а не строчка в закрытии.
 */
function ScreenClosing({state, busy, onClose, go}: {
  state: OperatorMobileState;
  busy: boolean;
  onClose: () => void;
  go: Go;
}) {
  const {assignment} = state;
  const closed = state.phase === 'CLOSED';
  // Сервер не закроет смену без послесменного обслуживания. Пока экран об
  // этом молчал, человек упирался в отказ и не знал, куда идти: ЕО после
  // работы живёт на другом экране, и попасть туда отсюда было нечем.
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
          <button type="button" className="ov10-btn green" onClick={() => go('maint')}>
            Выполнить ЕО после работы
          </button>
        </>
      ) : null}
      {!closed ? (
        <button
          type="button"
          className="ov10-btn orange"
          disabled={busy || !afterDone}
          onClick={onClose}
        >
          {busy ? 'Закрываем…' : 'Закрыть смену'}
        </button>
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
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState('today');
  const [answers, setAnswers] = useState<Record<string, OperatorAnswer>>({});
  /** Числовые замеры: моточасы, остаток топлива, доливы. */
  const [measures, setMeasures] = useState<Record<string, string>>({});

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

  /** Сдача осмотра: уходят ОТВЕТЫ ЧЕЛОВЕКА, а не «норма» по всем пунктам. */
  const submitChecklist = useCallback((stage: ChecklistStage) => {
    const shiftId = state?.shift?.id;
    const equipmentId = state?.assignment?.equipmentId;
    const list = state?.checklists.find((item) => item.stage === stage);
    if (!shiftId || !equipmentId || !list) {
      setNotice('Список недоступен: сначала примите установку.');
      return;
    }
    const items = list.sections.flatMap((section) => section.items);
    const missing = items.filter((item) => !answers[item.id]);
    if (missing.length > 0) {
      setNotice(`Без ответа пунктов: ${missing.length}. Список сдаётся целиком.`);
      return;
    }
    void run(() => sendCommand({
      command: 'submit-checklist',
      clientCommandId: commandId,
      shiftId,
      equipmentId,
      stage,
      answers: items.map((item) => ({
        itemId: item.id,
        answer: answers[item.id],
        measures: item.measure && (measures[item.measure.key] ?? '').trim() !== ''
          ? {[item.measure.key]: Number((measures[item.measure.key] ?? '').replace(',', '.'))}
          : undefined,
      })),
    }), list.title + ': сдано.');
    setMeasures({});
  }, [answers, commandId, measures, run, state]);

  const submitInspection = useCallback(
    () => submitChecklist('PRESHIFT_INSPECTION'),
    [submitChecklist],
  );

  const logProduction = useCallback((entry: ProductionEntryInput) => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setNotice('Смена не начата: записывать некуда.');
      return;
    }
    void run(
      () => sendCommand({command: 'log-production', clientCommandId: commandId, shiftId, entry}),
      'Записано.',
    );
  }, [commandId, run, state]);

  const closeShift = useCallback(() => {
    const shiftId = state?.shift?.id;
    if (!shiftId) {
      setNotice('Смена не начата: закрывать нечего.');
      return;
    }
    void run(() => sendCommand({command: 'close-shift', shiftId, comment: ''}), 'Смена закрыта.');
  }, [run, state]);

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
  }, [active, state, safety, safetyError, answers, loading, notice, loadError]);

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
        <ScreenSafetyChecklists
          state={state}
          answers={answers}
          measures={measures}
          busy={busy}
          onAnswer={(itemId, answer) => setAnswers((current2) => ({...current2, [itemId]: answer}))}
          onMeasure={(key, value) => setMeasures((current2) => ({...current2, [key]: value}))}
          onSubmit={submitChecklist}
          go={setActive}
        />
      );
      case 'accept': return <ScreenAccept state={state} busy={busy} onAccept={accept} go={setActive} />;
      case 'inspect': return (
        <ScreenInspect
          checklist={inspection}
          answers={answers}
          measures={measures}
          onAnswer={(itemId, answer) => setAnswers((current2) => ({...current2, [itemId]: answer}))}
          onMeasure={(key, value) => setMeasures((current2) => ({...current2, [key]: value}))}
          go={setActive}
        />
      );
      case 'ready': return (
        <ScreenReady state={state} checklist={inspection} answers={answers} busy={busy}
          onSubmit={submitInspection} go={setActive} />
      );
      case 'work': return (
        <ScreenWork state={state} busy={busy} onLog={logProduction} go={setActive} />
      );
      case 'maint': return (
        <ScreenMaint
          state={state}
          answers={answers}
          measures={measures}
          busy={busy}
          onAnswer={(itemId, answer) => setAnswers((current2) => ({...current2, [itemId]: answer}))}
          onMeasure={(key, value) => setMeasures((current2) => ({...current2, [key]: value}))}
          onSubmit={submitChecklist}
          go={setActive}
        />
      );
      case 'closing': return (
        <ScreenClosing state={state} busy={busy} onClose={closeShift} go={setActive} />
      );
      case 'report': return <ScreenReport state={state} />;
      default: return state.phase === 'WORK' ? <ScreenWork state={state} busy={busy} onLog={logProduction} go={setActive} /> : <ScreenToday state={state} go={setActive} />;
    }
  })();

  return (
    <div className="ov10-screen">
      <div className="ov10-top">
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
