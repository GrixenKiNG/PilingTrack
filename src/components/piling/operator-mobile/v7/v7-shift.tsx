'use client';

import {useState} from 'react';
import type {
  ChecklistAnswer, ChecklistView, IncidentSign, OperatorAnswer, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_HINTS, INCIDENT_CATEGORY_LABELS,
  INCIDENT_DESCRIPTION_MIN, INCIDENT_SIGN_LABELS, INCIDENT_SIGNS, measureRequired,
} from '@/modules/operator-mobile/contracts';
import {PilePassportForm} from '../screens/pile-passport-form';
import type {ProductionEntryInput} from '../api';
import {downtimeInterval, formatIntervalMinutes, hhmm} from '../downtime-interval';
import {Banner, Button, Card, CardBody, Field, Pair, Pick, Title} from './v7-ui';

/**
 * Действия смены: приём установки, чек-листы, учёт выработки, происшествие,
 * завершение работы и закрытие смены.
 *
 * Правила смены живут на сервере — экран их не дублирует, а подсказывает.
 * Поэтому здесь нет проверок вроде «чек-лист нельзя сдать раньше предыдущего»:
 * сервер откажет сам, а вторая копия правила рано или поздно разойдётся с
 * первой и начнёт разрешать то, что запрещено.
 */

/* ------------------------------------------------------ приём установки --- */

export function AcceptFlow({state, busy, onAccept, onBack}: {
  state: OperatorMobileState;
  busy: boolean;
  onAccept: (equipmentId: string, shiftType: 'DAY' | 'NIGHT') => void;
  onBack: () => void;
}) {
  const [equipmentId, setEquipmentId] = useState(
    state.assignment?.equipmentId ?? state.options[0]?.equipmentId ?? '',
  );
  const [shiftType, setShiftType] = useState<'DAY' | 'NIGHT'>('DAY');

  if (state.options.length === 0) {
    return (
      <>
        <Title>Принятие установки</Title>
        <div className="body">
          <Banner
            tone="bad"
            title="Установка за вами не закреплена"
            note="Работать не на чем: бригаду с машиной назначает диспетчер."
          />
          <Button tone="ghost" onClick={onBack}>Назад</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <Title note="Подтвердите объект и машину. С этого начинается смена: до приёма выработка не принимается.">
        Принятие установки
      </Title>
      <div className="body">
        <Card title="Установка">
          <CardBody>
            <div className="picks">
              {state.options.map((option) => (
                <Pick
                  key={option.equipmentId}
                  on={option.equipmentId === equipmentId}
                  onClick={() => setEquipmentId(option.equipmentId)}
                >
                  <span className="rb">
                    <span className="t">{option.equipmentName}</span>
                    <span className="s">{option.siteName}</span>
                  </span>
                </Pick>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card title="Смена">
          <CardBody>
            <div className="picks">
              <Pick on={shiftType === 'DAY'} onClick={() => setShiftType('DAY')}>Дневная</Pick>
              <Pick on={shiftType === 'NIGHT'} onClick={() => setShiftType('NIGHT')}>Ночная</Pick>
            </div>
          </CardBody>
        </Card>

        <Button disabled={busy || !equipmentId} onClick={() => onAccept(equipmentId, shiftType)}>
          {busy ? 'Принимаем…' : 'Принять установку'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- осмотр --- */

const ANSWERS: {value: OperatorAnswer; label: string; cls: string}[] = [
  {value: 'OK', label: 'Норма', cls: 'ok'},
  {value: 'REMARK', label: 'Замечание', cls: 'remark'},
  {value: 'FAULT', label: 'Неисправность', cls: 'fault'},
];

/**
 * Прохождение чек-листа.
 *
 * Пункт без ответа не пропускаем: список, где половина строк «не смотрел»,
 * подписывать нечем. Замер спрашиваем только там, где он обязателен при
 * выбранном ответе (`measureRequired`) — долив масла при «норме» не нужен.
 */
export function ChecklistFlow({checklist, busy, lastMeter, onSubmit, onBack}: {
  checklist: ChecklistView;
  busy: boolean;
  /** Последнее показание счётчика — подсказка у поля моточасов. */
  lastMeter: {engineHours: number; recordedAt: string} | null;
  onSubmit: (answers: ChecklistAnswer[]) => void;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, OperatorAnswer>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [measures, setMeasures] = useState<Record<string, string>>({});

  const items = checklist.sections.flatMap((section) => section.items);
  const unanswered = items.filter((item) => !answers[item.id]);
  const missingMeasure = items.filter((item) => {
    const answer = answers[item.id];
    if (!answer || !item.measure) return false;
    return measureRequired(item, answer) && !measures[item.id];
  });

  const submit = () => onSubmit(items.map((item) => {
    const answer = answers[item.id] as OperatorAnswer;
    const measureValue = item.measure && measures[item.id] !== undefined
      ? Number(measures[item.id])
      : null;
    return {
      itemId: item.id,
      answer,
      ...(notes[item.id] ? {note: notes[item.id]} : {}),
      ...(item.measure && measureValue !== null && Number.isFinite(measureValue)
        ? {measures: {[item.measure.key]: measureValue}}
        : {}),
    };
  }));

  return (
    <>
      <Title note={checklist.purpose}>{checklist.title}</Title>
      <div className="body">
        <div className="bar">
          <i style={{width: `${Math.round(((items.length - unanswered.length) / Math.max(items.length, 1)) * 100)}%`}} />
        </div>

        {checklist.sections.map((section) => (
          <Card key={section.id} title={section.title}>
            {section.items.map((item) => {
              const answer = answers[item.id];
              return (
                <div className="item" key={item.id}>
                  <span className="it">{item.text}</span>
                  {item.hint ? <span className="ih">{item.hint}</span> : null}
                  <div className="answers">
                    {ANSWERS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`${answer === option.value ? 'on ' : ''}${option.cls}`}
                        aria-pressed={answer === option.value}
                        onClick={() => setAnswers((current) => ({...current, [item.id]: option.value}))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {answer && answer !== 'OK' ? (
                    <div style={{marginTop: 8}}>
                      <Field label="Что именно">
                        <input
                          type="text"
                          value={notes[item.id] ?? ''}
                          onChange={(event) => setNotes((current) => ({...current, [item.id]: event.target.value}))}
                        />
                      </Field>
                    </div>
                  ) : null}
                  {answer && item.measure && measureRequired(item, answer) ? (
                    <div style={{marginTop: 8}}>
                      <Field
                        label={`${item.measure.label}, ${item.measure.unit}`
                          + (item.measure.max !== undefined
                            ? ` (от ${item.measure.min ?? 0} до ${item.measure.max})`
                            : '')}
                      >
                        <input
                          type="number"
                          inputMode="decimal"
                          value={measures[item.id] ?? ''}
                          onChange={(event) => setMeasures((current) => ({...current, [item.id]: event.target.value}))}
                        />
                        {/* Прошлое показание счётчика — у поля, а не на экране
                            приёмки, который к этому моменту давно закрыт.
                            Счётчик не крутится назад, и человек, видящий
                            вчерашнее число, ловит опечатку сам. Поле при этом
                            не заполняем: подставленное отправят не глядя. */}
                        {item.measure.key === 'engineHours' && lastMeter ? (
                          <span className="ih">
                            было {lastMeter.engineHours} м/ч
                            {' '}на {new Date(lastMeter.recordedAt).toLocaleDateString('ru-RU')}
                          </span>
                        ) : null}
                      </Field>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </Card>
        ))}

        {unanswered.length > 0 ? (
          <Banner tone="warn" title={`Без ответа: ${unanswered.length}`} note="Ответьте по каждому пункту." />
        ) : null}
        {missingMeasure.length > 0 ? (
          <Banner tone="warn" title={`Нужен замер: ${missingMeasure.length}`} />
        ) : null}
        {/* Фото к неисправности требует сервер. Съёмку здесь не делаем: это
            отдельный узел с загрузкой в хранилище, он живёт в рабочем экране. */}

        <Button
          disabled={busy || unanswered.length > 0 || missingMeasure.length > 0}
          onClick={submit}
        >
          {busy ? 'Отправляем…' : 'Сдать чек-лист'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ выработка --- */

type EntryKind = 'PILES' | 'PASSPORT' | 'DRILLING' | 'DOWNTIME';

const ENTRY_TITLE: Record<EntryKind, string> = {
  PILES: 'Забивка свай',
  PASSPORT: 'Свая с паспортом',
  DRILLING: 'Лидерное бурение',
  DOWNTIME: 'Простой',
};

export function ProductionFlow({state, busy, kind, onSubmit, onBack}: {
  state: OperatorMobileState;
  busy: boolean;
  kind: EntryKind;
  onSubmit: (entry: ProductionEntryInput) => void;
  onBack: () => void;
}) {
  const {pileGrades, drillingTypes, downtimeReasons} = state.dictionaries;
  const options = kind === 'PILES' || kind === 'PASSPORT' ? pileGrades
    : kind === 'DRILLING' ? drillingTypes : downtimeReasons;
  const [id, setId] = useState(options[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [startedHm, setStartedHm] = useState('');
  const [endedHm, setEndedHm] = useState('');
  const [meters, setMeters] = useState('');
  const [comment, setComment] = useState('');

  const value = Number(amount);
  const metersValue = Number(meters);
  // Простой считается по интервалу, а не по числу в поле: подпись под полями
  // и то, что уйдёт на сервер, — одна и та же величина.
  const interval = kind === 'DOWNTIME' ? downtimeInterval(startedHm, endedHm) : null;
  const ready = Boolean(id) && (
    kind === 'DOWNTIME'
      ? interval !== null
      : Number.isFinite(value) && value > 0
        && (kind !== 'DRILLING' || (Number.isFinite(metersValue) && metersValue > 0))
  );

  const submit = () => {
    if (kind === 'PILES') {
      onSubmit({kind: 'PILES', pileGradeId: id, count: value, ...(comment ? {comment} : {})});
      return;
    }
    if (kind === 'DRILLING') {
      onSubmit({kind: 'DRILLING', typeId: id, count: value, metersPerUnit: metersValue});
      return;
    }
    if (!interval) return;
    onSubmit({
      kind: 'DOWNTIME', reasonId: id,
      startedAt: interval.startedAt, endedAt: interval.endedAt,
      ...(comment ? {comment} : {}),
    });
  };

  if (options.length === 0) {
    return (
      <>
        <Title>{ENTRY_TITLE[kind]}</Title>
        <div className="body">
          <Banner tone="warn" title="Справочник пуст" note="Записывать не из чего — справочник заполняет администратор." />
          <Button tone="ghost" onClick={onBack}>Назад</Button>
        </div>
      </>
    );
  }

  /*
    Паспорт — журнал забивки на одну сваю: номер, залоги, отметки головы.
    Форма общая с остальными модулями, потому что требование к ней нормативное
    (СП 45.13330), а не наше: разойтись ей нельзя. Пачка при этом остаётся
    отдельной кнопкой — две цифры на ходу не должны идти мимо полей отказа.
  */
  if (kind === 'PASSPORT') {
    return (
      <>
        <Title note="Журнал забивки на одну сваю — залоги, отказ, отметки головы.">
          {ENTRY_TITLE[kind]}
        </Title>
        <div className="body">
          <PilePassportForm
            grades={pileGrades}
            busy={busy}
            onSubmit={async (pileGradeId, passport) => {
              onSubmit({kind: 'PILE_PASSPORT', pileGradeId, passport});
              return true;
            }}
          />
          <Button tone="ghost" onClick={onBack}>Назад</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <Title note="Записывается в отчёт смены — тот же, что видит администратор.">
        {ENTRY_TITLE[kind]}
      </Title>
      <div className="body">
        <Card title={kind === 'DOWNTIME' ? 'Причина' : (kind === 'PILES' ? 'Марка сваи' : 'Тип бурения')}>
          <CardBody>
            <div className="picks">
              {options.map((option) => (
                <Pick key={option.id} on={option.id === id} onClick={() => setId(option.id)}>
                  {option.name}
                </Pick>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            {kind === 'DOWNTIME' ? (
              <>
                <Field label="Простой начался">
                  <input type="time" value={startedHm}
                    onChange={(event) => setStartedHm(event.target.value)} />
                </Field>
                <Field label="Закончился">
                  <input type="time" value={endedHm}
                    onChange={(event) => setEndedHm(event.target.value)} />
                </Field>
                <Button tone="ghost" onClick={() => setEndedHm(hhmm(new Date()))}>
                  Закончился сейчас
                </Button>
                {interval ? (
                  <Pair label="Простой" value={formatIntervalMinutes(interval.minutes)} />
                ) : null}
              </>
            ) : (
              <Field label="Количество, шт.">
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
            )}
            {kind === 'DRILLING' ? (
              <Field label="Метров на скважину">
                <input
                  type="number"
                  inputMode="decimal"
                  value={meters}
                  onChange={(event) => setMeters(event.target.value)}
                />
              </Field>
            ) : null}
            {kind !== 'DRILLING' ? (
              <Field label="Примечание (необязательно)">
                <input type="text" value={comment} onChange={(event) => setComment(event.target.value)} />
              </Field>
            ) : null}
          </CardBody>
        </Card>

        <Button disabled={busy || !ready} onClick={submit}>
          {busy ? 'Записываем…' : 'Записать'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}

/* --------------------------------------------------------- происшествие --- */

export function IncidentFlow({busy, onSubmit, onBack}: {
  busy: boolean;
  onSubmit: (input: {
    category: string; signs: IncidentSign[]; injured: boolean; description: string;
  }) => void;
  onBack: () => void;
}) {
  const [category, setCategory] = useState<string>(INCIDENT_CATEGORIES[0]);
  /*
    ПРИЗНАКИ СПРАШИВАЕМ, А НЕ ОТПРАВЛЯЕМ ПУСТЫМИ.

    Их не было ни в форме, ни в замысле экрана: оболочка жёстко слала
    `signs: []`, сервер отвечал 400 «нужен хотя бы один признак», и
    происшествие НЕ СОЗДАВАЛОСЬ. Текст оставался на экране, человек уходил с
    ощущением, что записал. Это худший вид потери: не отказ, а молчаливое
    исчезновение.

    Признак здесь не формальность — по нему правило решает, насколько это
    опасно и надо ли поднимать тревогу. Происшествие без признаков — запись,
    по которой нельзя понять, надо ли бежать.
  */
  const [signs, setSigns] = useState<IncidentSign[]>([]);
  const [injured, setInjured] = useState(false);
  const [description, setDescription] = useState('');
  const short = description.trim().length < INCIDENT_DESCRIPTION_MIN;
  const noSigns = signs.length === 0;

  const toggleSign = (sign: IncidentSign) => setSigns((current) => (
    current.includes(sign) ? current.filter((item) => item !== sign) : [...current, sign]
  ));

  return (
    <>
      <Title note="Записывается сразу и уходит диспетчеру. Разбирается потом — сейчас важно зафиксировать.">
        Сообщить об инциденте
      </Title>
      <div className="body">
        <Card title="Что произошло">
          <CardBody>
            <div className="picks">
              {INCIDENT_CATEGORIES.map((value) => (
                <Pick key={value} on={category === value} onClick={() => setCategory(value)}>
                  <span className="rb">
                    <span className="t">{INCIDENT_CATEGORY_LABELS[value]}</span>
                    <span className="s">{INCIDENT_CATEGORY_HINTS[value]}</span>
                  </span>
                </Pick>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card title="Что было видно — отметьте всё, что подходит">
          <CardBody>
            <div className="picks">
              {INCIDENT_SIGNS.map((sign) => (
                <Pick key={sign} on={signs.includes(sign)} onClick={() => toggleSign(sign)}>
                  {INCIDENT_SIGN_LABELS[sign]}
                </Pick>
              ))}
            </div>
          </CardBody>
        </Card>

        <Pick box on={injured} onClick={() => setInjured((value) => !value)}>
          Есть пострадавший
        </Pick>

        <Card>
          <CardBody>
            <Field label="Опишите своими словами">
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <div className="note">Не меньше {INCIDENT_DESCRIPTION_MIN} символов.</div>
          </CardBody>
        </Card>

        <Button
          tone="danger"
          disabled={busy || short || noSigns}
          onClick={() => onSubmit({category, signs, injured, description: description.trim()})}
        >
          {busy ? 'Отправляем…'
            : noSigns ? 'Отметьте хотя бы один признак'
              : short ? `Опишите подробнее — не меньше ${INCIDENT_DESCRIPTION_MIN} знаков`
                : 'Записать происшествие'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Отмена</Button>
      </div>
    </>
  );
}

/* --------------------------------------------------------- сдача смены --- */

/**
 * Закрытие смены: одна кнопка и предупреждение, что дальше правит администратор.
 *
 * ЧЕГО ЗДЕСЬ БОЛЬШЕ НЕТ (решение владельца 18.09.2026). Поля «что передать
 * следующей смене» — передача машины это отдельное действие со своим
 * адресатом, а не строчка в закрытии. И галочки «выработка записана полностью»:
 * человек ставит её не глядя, потому что она стоит между ним и кнопкой, —
 * подтверждения она не даёт, а закрытие задерживает.
 */
export function CloseFlow({busy, onClose, onBack}: {
  busy: boolean;
  onClose: (comment: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <Title note="После закрытия смена уходит в отчёт и правится только администратором.">
        Закрытие смены
      </Title>
      <div className="body">
        <Button disabled={busy} onClick={() => onClose('')}>
          {busy ? 'Закрываем…' : 'Закрыть смену'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}
