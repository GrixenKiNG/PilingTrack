'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import {PilingIcon, type PilingIconName} from '@/components/piling/icons';
import {OperatorWorkOverview} from '../operator-mobile/operator-work-overview';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import type {
  ChecklistStage, ChecklistView, IncidentCategory, IncidentSign,
  OperatorAnswer, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS, INCIDENT_DESCRIPTION_MIN,
  INCIDENT_SIGN_LABELS, INCIDENT_SIGNS, PHASE_LABELS, PPE_ITEMS, SAFETY_BRIEFING,
  measureRequired,
} from '@/modules/operator-mobile/contracts';
import {KnowledgeScreen} from '../operator-mobile/screens/knowledge-screen';
import {PilePassportForm} from '../operator-mobile/screens/pile-passport-form';
import {formatNumber} from '@/lib/format';
import {
  ApiError, QueuedOffline, currentPosition, fetchState, newCommandId, sendCommand,
  type ProductionEntryInput,
} from '../operator-mobile/api';
import {downtimeInterval, formatIntervalMinutes, hhmm} from '../operator-mobile/downtime-interval';

/**
 * Рабочее место машиниста по макету v5 — на живых данных.
 *
 * ЧТО БЫЛО ЗДЕСЬ РАНЬШЕ. Тридцать четыре экрана макета, перенесённые дословно:
 * разметка без единого обработчика, переходы по подписям кнопок и данные из
 * документа — Сидоров А. В., Liebherr LRH 100, наряд № 118. Посмотреть путь
 * было можно, работать — нет: ни одного запроса к серверу модуль не делал.
 *
 * ЧТО ЗДЕСЬ СЕЙЧАС. Тот же визуальный язык (те же классы и те же экраны по
 * фазам смены) поверх настоящего состояния из `/api/operator/mobile/state`.
 * Источник данных и команды общие с `/operator`: сервер один, и правила
 * приёмки записи тоже одни. Своих маршрутов у модуля нет.
 *
 * ЧЕГО НЕТ И ПОЧЕМУ. Экрана «Вход по коду» из макета: входа по четырёхзначному
 * коду в продукте не существует, машинист уже вошёл своей учётной записью.
 * Нарисовать клавиатуру, которая ничего не проверяет, значило бы показать
 * защиту там, где её нет. Настоящий PIN — отдельное решение о том, как в поле
 * подтверждают личность, и принимается оно не в разметке макета.
 */

type Tab = 'SHIFT' | 'WORK' | 'DEFECTS' | 'EVENTS' | 'MORE';

const DASH = '—';

function timeRu(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}

function dateRu(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleDateString('ru-RU');
}

/* ------------------------------------------------------------- каркас --- */

function Bar({online}: {online: boolean}) {
  return (
    <div className="bar">
      <span>
        <span className={online ? 'dot' : 'dot off'} />
        {online ? 'На связи' : 'Без связи'}
      </span>
      <span>{new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</span>
    </div>
  );
}

function Top({state}: {state: OperatorMobileState}) {
  const {assignment} = state;
  if (!assignment) return null;
  return (
    <div className="top">
      <span className="mach">{assignment.equipmentName}</span>
      <span className="where">{assignment.siteName} · {state.operator.name}</span>
    </div>
  );
}

function Dock({active, onSelect}: {active: Tab; onSelect: (tab: Tab) => void}) {
  const tabs: {key: Tab; label: string; icon: PilingIconName}[] = [
    {key: 'SHIFT', label: 'Смена', icon: 'home'},
    {key: 'WORK', label: 'Работа', icon: 'pile-driving'},
    {key: 'DEFECTS', label: 'Дефекты', icon: 'defect'},
    {key: 'EVENTS', label: 'ЧП', icon: 'risk'},
    {key: 'MORE', label: 'Ещё', icon: 'menu'},
  ];
  return (
    <div className="dock">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={tab.key === active ? 'on' : ''}
          aria-current={tab.key === active ? 'page' : undefined}
          onClick={() => onSelect(tab.key)}
        >
          <PilingIcon name={tab.icon} size={24} decorative />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function Rowline({label, note, badge, tone, onClick}: {
  label: string;
  note?: string;
  badge?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'good';
  /** Задан — строка становится кнопкой. Без него это просто запись. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <span>
        {label}
        {note ? <><br /><span className="r">{note}</span></> : null}
      </span>
      {badge ? <span className={tone ? `badge ${tone}` : 'badge'}>{badge}</span> : null}
    </>
  );
  if (!onClick) return <div className="rowline">{body}</div>;
  return (
    <button type="button" className="rowline tap" onClick={onClick}>{body}</button>
  );
}


/**
 * Проверка средств защиты.
 *
 * ГАЛОЧКИ СТОЯТ ЗАРАНЕЕ — отмечают ОТСУТСТВИЕ. У работника, вышедшего на
 * смену, комплект обычно полон, и шесть обязательных нажатий в шесть утра
 * превращаются в шесть нажатий не глядя. Снимать отметку человек будет
 * осознанно.
 *
 * НЕХВАТКА НЕ ЗАПИРАЕТ САМ ЭКРАН. Запертый работник вернёт галочку обратно,
 * лишь бы начать смену, и мы получим ложную запись вместо честной. Отметку
 * принимаем любую — а вот выработку она после этого запрещает
 * (`domain/production-permit.ts`), и экран обязан сказать об этом прямо.
 */
function PpeScreenV5({busy, onConfirm, onBack}: {
  busy: boolean;
  onConfirm: (items: string[]) => void;
  onBack: () => void;
}) {
  const [present, setPresent] = useState<string[]>(() => PPE_ITEMS.map((item) => item.code));
  const missing = PPE_ITEMS.filter((item) => !present.includes(item.code));
  const toggle = (code: string) => setPresent((current) => (
    current.includes(code) ? current.filter((value) => value !== code) : [...current, code]
  ));

  return (
    <div className="scr">
      <p className="kicker">Средства защиты</p>
      <p className="m">Комплект отмечен полностью — снимите отметку с того, чего нет.</p>
      {PPE_ITEMS.map((item) => (
        <Rowline
          key={item.code}
          label={item.label}
          note={item.hint}
          badge={present.includes(item.code) ? 'есть' : 'нет'}
          tone={present.includes(item.code) ? 'good' : 'bad'}
          onClick={() => toggle(item.code)}
        />
      ))}
      {missing.length > 0 ? (
        <p className="note warn">
          Не хватает: {missing.map((item) => item.label).join(', ')}. Запишем как есть.
          Пока не получите недостающее, выработку записать нельзя — простой и
          происшествия записываются как обычно.
        </p>
      ) : null}
      <button className="b" type="button" disabled={busy} onClick={() => onConfirm(present)}>
        {busy ? 'Записываем…'
          : missing.length === 0 ? 'Комплект в порядке' : `Подтвердить (нет: ${missing.length})`}
      </button>
      <button className="b gh" type="button" onClick={onBack}>Назад</button>
    </div>
  );
}

/**
 * Ознакомление с инструкцией: сначала текст, потом отметка.
 *
 * Прежняя кнопка записывала ознакомление, не показав ни строчки. Подпись под
 * непрочитанным — это ровно та бумага, ради отказа от которой заводят
 * электронный журнал.
 */
function BriefingScreenV5({state, busy, onAcknowledge, onBack}: {
  state: OperatorMobileState;
  busy: boolean;
  onAcknowledge: () => void;
  onBack: () => void;
}) {
  const [read, setRead] = useState(false);
  const {briefing} = state.identity;
  return (
    <div className="scr">
      <p className="kicker">{SAFETY_BRIEFING.title}</p>
      <p className="m">
        {SAFETY_BRIEFING.code} · ред. {briefing.version} · чтение {SAFETY_BRIEFING.readingMinutes} мин
      </p>
      {SAFETY_BRIEFING.sections.map((section) => (
        <div key={section.id}>
          <p className="kicker">{section.title}</p>
          {section.rules.map((rule) => <p className="m" key={rule}>— {rule}</p>)}
        </div>
      ))}
      <Rowline
        label="Я ознакомился с инструкцией"
        badge={read ? 'да' : 'нет'}
        tone={read ? 'good' : 'warn'}
        onClick={() => setRead((value) => !value)}
      />
      <button
        className={read ? 'b' : 'b dis'}
        type="button"
        disabled={busy || !read}
        onClick={onAcknowledge}
      >
        {busy ? 'Записываем…' : 'Подтвердить ознакомление'}
      </button>
      <button className="b gh" type="button" onClick={onBack}>Назад</button>
    </div>
  );
}

/* -------------------------------------------------------------- экраны --- */


/** A. Допуск — экран A2 макета, но сроки настоящие. */
function AdmissionScreen({state, busy, onPpe, onBriefing, onKnowledge}: {
  state: OperatorMobileState;
  busy: boolean;
  onPpe: () => void;
  onBriefing: () => void;
  onKnowledge: () => void;
}) {
  const {identity} = state;
  const bad = identity.documents.filter(
    (doc) => doc.verdict === 'EXPIRED' || doc.verdict === 'MISSING',
  );

  return (
    <>
      {bad.length > 0 ? (
        <div className="stop-head">
          <span className="t">Работать нельзя</span>
          <span className="s">
            {bad[0].name}: {bad[0].verdict === 'EXPIRED' ? 'просрочен' : 'нет документа'}
          </span>
        </div>
      ) : (
        <div className="ok-head">
          <span className="t">Допуск открыт</span>
          <span className="s">Все документы действуют</span>
        </div>
      )}
      <div className="scr">
        <Rowline
          label="Средства индивидуальной защиты"
          note={identity.ppe.confirmedAt
            ? `подтверждены в ${timeRu(identity.ppe.confirmedAt)}`
            : 'проверка за сегодня'}
          badge={identity.ppe.confirmed ? 'есть' : 'нужна'}
          tone={identity.ppe.confirmed ? 'ok' : 'warn'}
        />
        <Rowline
          label={identity.briefing.title}
          note={`${identity.briefing.code} · ред. ${identity.briefing.version}`}
          badge={identity.briefing.ok ? 'учтён' : 'новая'}
          tone={identity.briefing.ok ? 'ok' : 'warn'}
        />
        <Rowline
          label="Проверка знаний по ОТ"
          note={identity.knowledge.validUntil
            ? `действует до ${dateRu(identity.knowledge.validUntil)}`
            : undefined}
          badge={identity.knowledge.ok ? 'есть' : 'нужна'}
          tone={identity.knowledge.ok ? 'ok' : 'warn'}
        />
        {identity.documents.map((doc) => (
          <Rowline
            key={doc.typeId}
            label={doc.name}
            badge={doc.expiresAt ? `до ${dateRu(doc.expiresAt as unknown as string)}` : 'бессрочный'}
            tone={doc.verdict === 'VALID' ? 'ok' : doc.verdict === 'EXPIRING' ? 'warn' : 'bad'}
          />
        ))}

        {/*
          ШАГИ ДОПУСКА ОТКРЫВАЮТ СВОЙ ЭКРАН, А НЕ ЗАПИСЫВАЮТ ФАКТ ПО НАЖАТИЮ.

          Было две кнопки, которые отправляли команду прямо отсюда. «Подтвердить
          средства защиты» слала `items: state.identity.ppe.items` — а до
          подтверждения этот список ПУСТ, потому что хранит уже записанное.
          Сервер честно записывал, что у человека нет ни одного из шести
          предметов, а экран тут же показывал «есть»: ложная запись о
          безопасности, сделанная одним нажатием. «Ознакомиться с инструкцией»
          записывала ознакомление, не показав ни строчки текста.

          Теперь обе ведут на экран, где человек действительно смотрит и
          отвечает. Проверка знаний добавлена туда же: без неё допуск нового
          оператора упирался в тупик — шаг обязателен, а пройти его в модуле
          было негде.
        */}
        {!identity.ppe.confirmed ? (
          <button className="b" type="button" disabled={busy} onClick={onPpe}>
            Проверить средства защиты
          </button>
        ) : !identity.briefing.ok ? (
          <button className="b" type="button" disabled={busy} onClick={onBriefing}>
            Прочитать инструкцию
          </button>
        ) : !identity.knowledge.ok ? (
          <button className="b" type="button" disabled={busy} onClick={onKnowledge}>
            Пройти проверку знаний
          </button>
        ) : null}

        {bad.length > 0 ? (
          <p className="note bad">
            Эту блокировку нельзя снять разрешением. Нужен действующий документ.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** C. Приёмка машины — экран C2 макета. */
function AcceptScreen({state, busy, onAccept}: {
  state: OperatorMobileState;
  busy: boolean;
  onAccept: (equipmentId: string) => void;
}) {
  const {assignment, options} = state;
  return (
    <div className="scr">
      <p className="kicker">Приёмка машины</p>
      {options.length === 0 ? (
        <p className="note bad">За вами не закреплена установка. Обратитесь к администратору.</p>
      ) : options.map((option) => (
        <div className="card" key={option.equipmentId}>
          <span className="lbl">{option.equipmentName}</span>
          <p>{option.siteName}</p>
          <button
            className="b"
            type="button"
            disabled={busy}
            onClick={() => onAccept(option.equipmentId)}
          >
            Принять машину
          </button>
        </div>
      ))}
      {assignment?.lastMeter ? (
        <div className="card">
          <span className="lbl">Моточасы</span>
          <p>{formatNumber(assignment.lastMeter.engineHours, 0)} м/ч</p>
          <p className="m">последнее показание от {dateRu(assignment.lastMeter.recordedAt)}</p>
        </div>
      ) : null}
    </div>
  );
}

/** D/E. Чек-лист этапа — экраны D1–D4 и E1 макета. */
function ChecklistScreen({checklist, answers, measures, busy, lastMeter, onAnswer, onMeasure, onSubmit}: {
  checklist: ChecklistView;
  answers: Record<string, OperatorAnswer>;
  measures: Record<string, string>;
  busy: boolean;
  /** Последнее показание счётчика — подсказка у поля моточасов. */
  lastMeter: {engineHours: number; recordedAt: string} | null;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  onMeasure: (key: string, value: string) => void;
  onSubmit: () => void;
}) {
  const items = checklist.sections.flatMap((section) => section.items);
  // Замер обязателен при таком ответе — без него сервер список не примет.
  const needsMeasure = (item: (typeof items)[number]) => Boolean(item.measure)
    && measureRequired(item, answers[item.id] ?? 'OK');
  const left = items.filter(
    (item) => !answers[item.id]
      || (needsMeasure(item) && !(measures[item.measure?.key ?? ''] ?? '').trim()),
  ).length;
  const done = items.length - left;
  return (
    <>
      <div className="pbar">
        <i style={{width: `${items.length ? (done / items.length) * 100 : 0}%`}} />
      </div>
      <div className="scr">
        <p className="kicker">{checklist.title}</p>
        <p className="m">{checklist.purpose}</p>
        {checklist.sections.map((section) => (
          <div key={section.id}>
            <p className="kicker">{section.title}</p>
            {section.items.map((item) => (
              <div className="rowline" key={item.id}>
                <span>
                  {item.severity === 'ALERT' ? <span className="crit">! </span> : null}
                  {item.text}
                  {item.hint ? <><br /><span className="r">{item.hint}</span></> : null}
                </span>
                <span className="ans">
                  <button
                    type="button"
                    className={answers[item.id] === 'OK' ? 'on' : ''}
                    onClick={() => onAnswer(item.id, 'OK')}
                  >
                    норма
                  </button>
                  <button
                    type="button"
                    className={answers[item.id] === 'FAULT' ? 'bad' : ''}
                    onClick={() => onAnswer(item.id, 'FAULT')}
                  >
                    дефект
                  </button>
                </span>
              </div>
            ))}
            {section.items.filter(needsMeasure).map((item) => (
              <div className="card" key={item.id + '-m'}>
                <span className="lbl">
                  {item.measure?.label}, {item.measure?.unit}
                  {item.measure?.max !== undefined
                    ? ` (от ${item.measure.min ?? 0} до ${item.measure.max})`
                    : ''}
                </span>
                <input
                  inputMode="decimal"
                  value={measures[item.measure?.key ?? ''] ?? ''}
                  onChange={(event) => onMeasure(item.measure?.key ?? '', event.target.value)}
                />
                {/* Прошлое показание счётчика — рядом с полем, а не на экране
                    приёмки, который к этому моменту давно закрыт. Счётчик не
                    крутится назад, и человек, видящий вчерашнее число, ловит
                    свою опечатку сам — до того, как сервер откажет. Поле при
                    этом не заполняем: подставленное отправят не глядя. */}
                {item.measure?.key === 'engineHours' && lastMeter ? (
                  <span className="m">
                    было {formatNumber(lastMeter.engineHours, 0)} м/ч
                    {' '}на {dateRu(lastMeter.recordedAt)}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        <button
          className={left > 0 ? 'b dis' : 'b'}
          type="button"
          disabled={busy || left > 0}
          onClick={onSubmit}
        >
          {busy ? 'Отправляем…' : left > 0 ? `Осталось отметить: ${left}` : 'Завершить'}
        </button>
      </div>
    </>
  );
}

/**
 * Происшествие смены — журнал и запись нового.
 *
 * ПОЧЕМУ НЕ ОБЩАЯ ФОРМА ИЗ `operator-mobile/screens`. Она написана на общей
 * системе стилей продукта, а весь смысл этого модуля — проверить макет
 * владельца в его собственном языке: плотный экран без прокрутки, плоские
 * строки, один шрифт. Вставленная сюда чужая панель ломала бы ровно то, что
 * здесь измеряют. Правила и команда при этом общие — расходится оформление,
 * а не то, что попадает в базу.
 *
 * ПОЧЕМУ ЗАПИСЬ НИЧЕГО НЕ ЗАПИРАЕТ. Правило по признакам само решает,
 * насколько это опасно, но работы прекращает человек: приложение не видит
 * площадку и не знает, чем обернётся остановка посреди погружения сваи.
 */
function IncidentScreen({state, busy, onReport}: {
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
    <div className="scr">
      <p className="kicker">Происшествия смены</p>
      {state.incidents.length === 0
        ? <p className="note good">Происшествий не записано</p>
        : state.incidents.map((incident) => (
          <Rowline
            key={incident.id}
            label={INCIDENT_CATEGORY_LABELS[incident.category]}
            note={`${timeRu(incident.occurredAt)} · ${incident.description}`}
            badge={incident.reviewedAt ? 'разобрано' : 'на виду'}
            tone={incident.reviewedAt ? 'good' : 'warn'}
          />
        ))}

      {!open ? (
        <button className="b gh" type="button" onClick={() => setOpen(true)}>
          Записать происшествие
        </button>
      ) : (
        <div className="card">
          <span className="lbl">Что произошло</span>
          <select value={category}
            onChange={(event) => setCategory(event.target.value as IncidentCategory)}>
            <option value="">Выберите…</option>
            {INCIDENT_CATEGORIES.map((item) => (
              <option key={item} value={item}>{INCIDENT_CATEGORY_LABELS[item]}</option>
            ))}
          </select>

          {/* Хотя бы один признак обязателен: по ним правило решает, насколько
              это опасно. Происшествие без признаков — запись, по которой
              нельзя понять, надо ли бежать. */}
          <span className="lbl">Признаки — отметьте всё, что было</span>
          <span className="ans wrap">
            {INCIDENT_SIGNS.map((sign) => (
              <button
                key={sign}
                type="button"
                className={signs.includes(sign) ? 'on' : ''}
                onClick={() => toggle(sign)}
              >
                {INCIDENT_SIGN_LABELS[sign]}
              </button>
            ))}
          </span>

          <span className="ans">
            <button type="button" className={injured ? 'bad' : ''} onClick={() => setInjured(true)}>
              есть пострадавшие
            </button>
            <button type="button" className={injured ? '' : 'on'} onClick={() => setInjured(false)}>
              пострадавших нет
            </button>
          </span>

          <span className="lbl">Как было дело</span>
          <textarea
            rows={4}
            value={description}
            maxLength={4000}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button
            className={ready ? 'b' : 'b dis'}
            type="button"
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
        </div>
      )}
    </div>
  );
}

/** F. Работа: плитки выработки и запись — экраны F1–F5 макета. */
function WorkScreen({state, busy, onLog, onFinish, onOpenSafety, onIncident}: {
  state: OperatorMobileState;
  busy: boolean;
  onLog: (entry: ProductionEntryInput) => void;
  onFinish: () => void;
  onIncident: () => void;
  /** Открыть периодический чек-лист ТБ — срок вышел либо подходит. */
  onOpenSafety: (stage: ChecklistStage) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<'PILES' | 'DRILLING' | 'DOWNTIME' | 'PASSPORT'>('PILES');
  const [optionId, setOptionId] = useState('');
  const [count, setCount] = useState('');
  const [meters, setMeters] = useState('');
  const [startedHm, setStartedHm] = useState('');
  const [endedHm, setEndedHm] = useState('');

  const options = kind === 'PILES' || kind === 'PASSPORT' ? state.dictionaries.pileGrades
    : kind === 'DRILLING' ? state.dictionaries.drillingTypes
      : state.dictionaries.downtimeReasons;

  /*
    Чек-листы ТБ периодические: их проходят по сроку инструкции, а не каждую
    смену. Показываем их здесь, на рабочем экране, потому что именно тут
    человек упирается в отказ сервера «подошёл срок чек-листа ТБ» — а пройти
    его в модуле раньше было негде вовсе.
  */
  const safety = state.checklists.filter((list) => list.period !== null);

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

  const pick = (next: typeof kind) => {
    setKind(next);
    setOptionId('');
    setCount('');
    setMeters('');
    setStartedHm('');
    setEndedHm('');
  };

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

  if (!formOpen) return <div className="scr"><OperatorWorkOverview state={state} variant="v5" busy={busy}
    onAction={(next)=>{pick(next);setFormOpen(true);}} onFinish={onFinish} onIncident={onIncident}>
    {safety.filter(c=>c.period?.due||c.period?.warn).map(c=><button key={c.stage} type="button" className="oc-form-back" onClick={()=>onOpenSafety(c.stage)}>{c.title} · пройти проверку</button>)}
  </OperatorWorkOverview></div>;

  return (
    <div className="scr">
      <button type="button" className="oc-form-back" onClick={()=>setFormOpen(false)}>← К смене</button>
      <div className="tiles">
        <div className="tile">
          <span className="k">Сваи</span>
          <span className="v">{formatNumber(state.production.piles.count, 0)}</span>
          <span className="m">{formatNumber(state.production.piles.meters, 0)} м.п.</span>
        </div>
        <div className="tile">
          <span className="k">Бурение</span>
          <span className="v">{formatNumber(state.production.drilling.count, 0)}</span>
          <span className="m">{formatNumber(state.production.drilling.meters, 0)} м.п.</span>
        </div>
        <div className="tile">
          <span className="k">Простой</span>
          <span className="v">{formatDowntimeHours(state.production.downtimeHours)}</span>
        </div>
      </div>

      {safety.map((list) => (
        <Rowline
          key={list.stage}
          label={list.title}
          note={list.period?.due
            ? 'срок подошёл — пройдите, иначе запись не примут'
            : list.period?.warn
              ? `срок через ${list.period.daysLeft} дн. — можно пройти заранее`
              : `действует до ${dateRu(list.period?.validUntil)}`}
          badge={list.period?.due ? 'пройти' : list.period?.warn ? 'скоро' : 'в норме'}
          tone={list.period?.due ? 'bad' : list.period?.warn ? 'warn' : 'good'}
          onClick={list.period?.due || list.period?.warn
            ? () => onOpenSafety(list.stage)
            : undefined}
        />
      ))}

      <div className="seg">
        <button type="button" className={kind === 'PILES' ? 'on' : ''} onClick={() => pick('PILES')}>
          Свая
        </button>
        <button type="button" className={kind === 'PASSPORT' ? 'on' : ''} onClick={() => pick('PASSPORT')}>
          Паспорт
        </button>
        <button type="button" className={kind === 'DRILLING' ? 'on' : ''} onClick={() => pick('DRILLING')}>
          Бурение
        </button>
        <button type="button" className={kind === 'DOWNTIME' ? 'on' : ''} onClick={() => pick('DOWNTIME')}>
          Простой
        </button>
      </div>

      {/* Паспорт — журнал забивки на одну сваю: номер, залоги, отметки головы.
          Форма общая с остальными модулями, потому что требование к ней не
          наше, а нормативное (СП 45.13330), и расходиться ей нельзя. */}
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
      <div className="card">
        <span className="lbl">
          {kind === 'PILES' ? 'Марка сваи' : kind === 'DRILLING' ? 'Тип бурения' : 'Причина простоя'}
        </span>
        <select value={optionId} onChange={(event) => setOptionId(event.target.value)}>
          <option value="">Выберите…</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
        {forbidden ? (
          <p className="ov5-hint">
            Работа запрещена: {state.permit.blocks.map((block) => block.title).join('; ')}.
            Простой записывается как обычно.
          </p>
        ) : null}

        {kind === 'DOWNTIME' ? (
          <>
            <span className="lbl">Простой начался</span>
            <input type="time" value={startedHm}
              onChange={(event) => setStartedHm(event.target.value)} />
            <span className="lbl">Закончился</span>
            <input type="time" value={endedHm}
              onChange={(event) => setEndedHm(event.target.value)} />
            <button type="button" className="ov5-rowbtn"
              onClick={() => setEndedHm(hhmm(new Date()))}>Закончился сейчас</button>
            {interval ? (
              <p className="ov5-hint">Простой: {formatIntervalMinutes(interval.minutes)}</p>
            ) : null}
          </>
        ) : (
          <>
            <span className="lbl">Количество, шт</span>
            <input inputMode="decimal" value={count} onChange={(event) => setCount(event.target.value)} />
          </>
        )}
        {kind === 'DRILLING' ? (
          <>
            <span className="lbl">Метров на скважину</span>
            <input inputMode="decimal" value={meters} onChange={(event) => setMeters(event.target.value)} />
          </>
        ) : null}
        <button
          className={ready ? 'b' : 'b dis'}
          type="button"
          disabled={busy || !ready}
          onClick={submit}
        >
          {busy ? 'Записываем…' : 'Записать'}
        </button>
      </div>
      )}

      <button className="b gh" type="button" disabled={busy} onClick={onFinish}>
        Машина безопасно остановлена
      </button>
    </div>
  );
}

/** G. Сдача смены и итог — экраны G4, G5 макета. */
function CloseScreen({state, busy, onClose}: {
  state: OperatorMobileState;
  busy: boolean;
  onClose: () => void;
}) {
  const {receipt} = state;
  const tiles = (
    <div className="tiles">
      <div className="tile">
        <span className="k">Сваи</span>
        <span className="v">{formatNumber(state.production.piles.count, 0)}</span>
        <span className="m">{formatNumber(state.production.piles.meters, 0)} м.п.</span>
      </div>
      <div className="tile">
        <span className="k">Бурение</span>
        <span className="v">{formatNumber(state.production.drilling.count, 0)}</span>
        <span className="m">{formatNumber(state.production.drilling.meters, 0)} м.п.</span>
      </div>
      <div className="tile">
        <span className="k">Простой</span>
        <span className="v">{formatDowntimeHours(state.production.downtimeHours)}</span>
      </div>
    </div>
  );

  if (state.phase === 'CLOSED') {
    return (
      <>
        <div className="ok-head">
          <span className="t">Смена закрыта</span>
          <span className="s">Отчёт отправлен диспетчеру</span>
        </div>
        <div className="scr">
          {receipt ? (
            <div className="card">
              <span className="lbl">Отчёт</span>
              <p>{receipt.reportId}</p>
              <p className="m">
                отправлен {dateRu(receipt.submittedAt)} · закрыт {dateRu(receipt.closedAt)}
              </p>
            </div>
          ) : null}
          {tiles}
        </div>
      </>
    );
  }

  return (
    <div className="scr">
      <p className="kicker">Сдача смены</p>
      {tiles}
      <button className="b" type="button" disabled={busy} onClick={onClose}>
        {busy ? 'Закрываем…' : 'Закрыть смену'}
      </button>
      <p className="note">
        После закрытия смена уходит в отчёт и правится только администратором.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------- приложение --- */

export function OperatorV5App() {
  const [state, setState] = useState<OperatorMobileState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('SHIFT');
  const [answers, setAnswers] = useState<Record<string, OperatorAnswer>>({});
  /** Числовые замеры текущего списка: моточасы, остаток топлива, доливы. */
  const [measures, setMeasures] = useState<Record<string, string>>({});
  const [commandId, setCommandId] = useState(newCommandId);
  const [online, setOnline] = useState(true);

  const reload = useCallback(async () => {
    try {
      const coordinates = await currentPosition();
      setState(await fetchState({coordinates}));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError || cause instanceof Error
        ? cause.message
        : 'Состояние смены недоступно');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первое чтение состояния при монтировании
    void reload();
  }, [reload]);

  useEffect(() => {
    const update = () => setOnline(globalThis.navigator?.onLine ?? true);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
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

  /**
   * Периодический чек-лист ТБ, открытый по сроку.
   *
   * Он не привязан к фазе смены: инструктаж действует месяцами, и его проходят
   * когда подошёл срок, а не каждое утро. Поэтому это отдельный выбор
   * человека, а не следующий шаг цикла.
   */
  const [safetyStage, setSafetyStage] = useState<ChecklistStage | null>(null);
  /** Открытый шаг допуска. null — показываем обычный экран фазы. */
  const [admissionStep, setAdmissionStep] = useState<'PPE' | 'BRIEFING' | 'KNOWLEDGE' | null>(null);

  /** Чек-лист, закрывающий текущую фазу. Порядок тот же, что на сервере. */
  const stage: ChecklistStage | null = useMemo(() => {
    if (!state) return null;
    if (safetyStage) return safetyStage;
    if (state.phase === 'PRESHIFT_INSPECTION') return 'PRESHIFT_INSPECTION';
    if (state.phase === 'STARTUP') return 'EO_BEFORE';
    if (state.phase === 'SITE_READY') return 'SITE_READY';
    if (state.phase === 'CLOSING') return 'EO_AFTER';
    return null;
  }, [state, safetyStage]);

  /**
   * Сданный список больше не показываем.
   *
   * Фаза смены меняется не мгновенно: «ЕО после работы» закрывает фазу CLOSING,
   * но пока отчёт не отправлен, фаза та же. Без проверки done экран показывал
   * бы только что сданный чек-лист заново, и человек отвечал бы второй раз.
   */
  const checklist = useMemo(() => {
    if (!stage) return null;
    const list = state?.checklists.find((item) => item.stage === stage) ?? null;
    if (!list) return null;
    // Чек-лист ТБ, открытый по сроку, показываем даже когда он ещё «в норме»:
    // пройти его заранее — законное действие, за которое человека не наказывают.
    if (safetyStage) return list;
    return list.done ? null : list;
  }, [stage, state, safetyStage]);

  const submitChecklist = useCallback(() => {
    const shiftId = state?.shift?.id;
    const equipmentId = state?.assignment?.equipmentId;
    if (!shiftId || !equipmentId || !checklist || !stage) return;
    const items = checklist.sections.flatMap((section) => section.items);
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
        // Сервер требует описание к неисправности. Экран макета отдельного
        // поля не предусматривает, поэтому пишем честный источник ответа.
        note: answers[item.id] === 'FAULT' ? 'Отмечено машинистом на осмотре' : undefined,
      })),
    }), `${checklist.title}: принято.`);
    setMeasures({});
    setAnswers({});
    // Периодический список сдан — возвращаемся туда, откуда его открыли.
    setSafetyStage(null);
  }, [answers, checklist, commandId, measures, run, stage, state]);

  const reportIncident = useCallback((input: {
    category: IncidentCategory; signs: IncidentSign[]; injured: boolean; description: string;
  }) => {
    const shiftId = state?.shift?.id;
    if (!shiftId) return;
    void run(() => sendCommand({
      command: 'report-incident', clientCommandId: commandId, shiftId, ...input,
    }), 'Происшествие записано.');
  }, [commandId, run, state]);

  const logProduction = useCallback((entry: ProductionEntryInput) => {
    const shiftId = state?.shift?.id;
    if (!shiftId) return;
    void run(
      () => sendCommand({command: 'log-production', clientCommandId: commandId, shiftId, entry}),
      'Записано.',
    );
  }, [commandId, run, state]);

  if (error) {
    return <div className="app"><div className="scr"><p className="note bad">{error}</p></div></div>;
  }
  if (!state) {
    return <div className="app"><div className="scr"><p className="note">Читаем состояние смены…</p></div></div>;
  }

  const shiftId = state.shift?.id ?? null;

  const body = () => {
    /*
      Шаг допуска перекрывает экран фазы: у каждого свой порядок и своя кнопка.
      Проверка знаний взята готовой из рабочего места `/operator` — свой банк
      вопросов у модуля заводить незачем, он один на продукт.
    */
    if (admissionStep === 'PPE') {
      return (
        <PpeScreenV5
          busy={busy}
          onBack={() => setAdmissionStep(null)}
          onConfirm={(items) => {
            setAdmissionStep(null);
            void run(() => sendCommand({
              command: 'confirm-ppe', productionDate: state.productionDate, items,
            }), 'Средства защиты проверены.');
          }}
        />
      );
    }
    if (admissionStep === 'BRIEFING') {
      return (
        <BriefingScreenV5
          state={state}
          busy={busy}
          onBack={() => setAdmissionStep(null)}
          onAcknowledge={() => {
            setAdmissionStep(null);
            void run(() => sendCommand({command: 'acknowledge-briefing'}), 'Ознакомление записано.');
          }}
        />
      );
    }
    if (admissionStep === 'KNOWLEDGE') {
      return (
        <KnowledgeScreen
          busy={busy}
          error={error}
          onBack={() => setAdmissionStep(null)}
          onDone={(picks, attemptToken) => {
            setAdmissionStep(null);
            void run(() => sendCommand({
              command: 'submit-knowledge', attemptToken, picks,
            }), 'Проверка знаний записана.');
          }}
        />
      );
    }

    if (tab === 'DEFECTS') {
      return (
        <div className="scr">
          <p className="kicker">Открытые неисправности</p>
          {state.defects.length === 0
            ? <p className="note good">Открытых неисправностей нет</p>
            : state.defects.map((defect) => (
              <Rowline
                key={defect.id}
                label={defect.title}
                note={`${defect.reportedByMe ? 'записали вы' : defect.reportedByName} · ${dateRu(defect.reportedAt)}`}
                badge="открыт"
                tone="warn"
              />
            ))}
        </div>
      );
    }

    if (tab === 'EVENTS') {
      return <IncidentScreen state={state} busy={busy} onReport={reportIncident} />;
    }

    if (tab === 'MORE') {
      return (
        <div className="scr">
          <p className="kicker">Журнал смены</p>
          {state.entries.length === 0
            ? <p className="note">За смену пока ничего не записано</p>
            : state.entries.map((entry) => (
              <Rowline
                key={entry.id}
                label={entry.label}
                note={timeRu(entry.occurredAt)}
                badge={`${formatNumber(entry.value, 0)}${entry.kind === 'DOWNTIME' ? ' ч' : ' шт'}`}
              />
            ))}
          <p className="kicker">Смена</p>
          <Rowline label="Этап" badge={PHASE_LABELS[state.phase]} />
          <Rowline label="Производственные сутки" badge={dateRu(state.productionDate)} />
        </div>
      );
    }

    if (tab === 'WORK' && state.phase !== 'WORK') {
      return (
        <div className="scr">
          <p className="note warn">
            Учёт откроется после допуска и осмотра. Сейчас: {PHASE_LABELS[state.phase]}
          </p>
        </div>
      );
    }

    // Открытый по сроку чек-лист ТБ перекрывает рабочий экран: человек его сам
    // и открыл, и возврат — по кнопке «Завершить» внизу списка.
    if (state.phase === 'WORK' && !safetyStage) {
      return (
        <WorkScreen
          state={state}
          busy={busy}
          onLog={logProduction}
          onOpenSafety={setSafetyStage}
          onIncident={()=>setTab('EVENTS')}
          onFinish={() => {
            if (shiftId) void run(() => sendCommand({command: 'finish-work', shiftId}), 'Работа завершена.');
          }}
        />
      );
    }

    if (state.phase === 'IDENTITY') {
      return (
        <AdmissionScreen
          state={state}
          busy={busy}
          onPpe={() => setAdmissionStep('PPE')}
          onBriefing={() => setAdmissionStep('BRIEFING')}
          onKnowledge={() => setAdmissionStep('KNOWLEDGE')}
        />
      );
    }

    if (state.phase === 'ADMISSION') {
      return (
        <AcceptScreen
          state={state}
          busy={busy}
          onAccept={(equipmentId) => void run(
            () => sendCommand({
              command: 'accept-equipment',
              clientCommandId: commandId,
              equipmentId,
              shiftType: 'DAY',
            }),
            'Машина принята.',
          )}
        />
      );
    }

    if (checklist) {
      return (
        <ChecklistScreen
          checklist={checklist}
          answers={answers}
          measures={measures}
          busy={busy}
          lastMeter={state.assignment?.lastMeter ?? null}
          onAnswer={(itemId, answer) => setAnswers((current) => ({...current, [itemId]: answer}))}
          onMeasure={(key, value) => setMeasures((current) => ({...current, [key]: value}))}
          onSubmit={submitChecklist}
        />
      );
    }

    return (
      <CloseScreen
        state={state}
        busy={busy}
        onClose={() => {
          if (shiftId) void run(() => sendCommand({command: 'close-shift', shiftId, comment: ''}), 'Смена закрыта.');
        }}
      />
    );
  };

  return (
    <div className="app">
      <Bar online={online} />
      <Top state={state} />
      {notice ? <p className="note">{notice}</p> : null}
      {body()}
      <Dock active={tab} onSelect={setTab} />
    </div>
  );
}
