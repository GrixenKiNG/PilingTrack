'use client';

import {useState} from 'react';
import type {
  ChecklistAnswer, ChecklistView, OperatorAnswer, OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_HINTS, INCIDENT_CATEGORY_LABELS,
  INCIDENT_DESCRIPTION_MIN, measureRequired,
} from '@/modules/operator-mobile/contracts';
import type {ProductionEntryInput} from '../api';
import {Banner, Button, Card, CardBody, Field, Pick, Title} from './v7-ui';

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
export function ChecklistFlow({checklist, busy, onSubmit, onBack}: {
  checklist: ChecklistView;
  busy: boolean;
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
                      <Field label={`${item.measure.label}, ${item.measure.unit}`}>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={measures[item.id] ?? ''}
                          onChange={(event) => setMeasures((current) => ({...current, [item.id]: event.target.value}))}
                        />
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

type EntryKind = 'PILES' | 'DRILLING' | 'DOWNTIME';

const ENTRY_TITLE: Record<EntryKind, string> = {
  PILES: 'Забивка свай', DRILLING: 'Лидерное бурение', DOWNTIME: 'Простой',
};

export function ProductionFlow({state, busy, kind, onSubmit, onBack}: {
  state: OperatorMobileState;
  busy: boolean;
  kind: EntryKind;
  onSubmit: (entry: ProductionEntryInput) => void;
  onBack: () => void;
}) {
  const {pileGrades, drillingTypes, downtimeReasons} = state.dictionaries;
  const options = kind === 'PILES' ? pileGrades : kind === 'DRILLING' ? drillingTypes : downtimeReasons;
  const [id, setId] = useState(options[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [meters, setMeters] = useState('');
  const [comment, setComment] = useState('');

  const value = Number(amount);
  const metersValue = Number(meters);
  const ready = Boolean(id) && Number.isFinite(value) && value > 0
    && (kind !== 'DRILLING' || (Number.isFinite(metersValue) && metersValue > 0));

  const submit = () => {
    if (kind === 'PILES') {
      onSubmit({kind: 'PILES', pileGradeId: id, count: value, ...(comment ? {comment} : {})});
      return;
    }
    if (kind === 'DRILLING') {
      onSubmit({kind: 'DRILLING', typeId: id, count: value, metersPerUnit: metersValue});
      return;
    }
    onSubmit({kind: 'DOWNTIME', reasonId: id, hours: value, ...(comment ? {comment} : {})});
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
            <Field label={kind === 'DOWNTIME' ? 'Часов' : 'Количество, шт.'}>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
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
  onSubmit: (input: {category: string; injured: boolean; description: string}) => void;
  onBack: () => void;
}) {
  const [category, setCategory] = useState<string>(INCIDENT_CATEGORIES[0]);
  const [injured, setInjured] = useState(false);
  const [description, setDescription] = useState('');
  const short = description.trim().length < INCIDENT_DESCRIPTION_MIN;

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
          disabled={busy || short}
          onClick={() => onSubmit({category, injured, description: description.trim()})}
        >
          {busy ? 'Отправляем…' : 'Записать происшествие'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Отмена</Button>
      </div>
    </>
  );
}

/* --------------------------------------------------------- сдача смены --- */

export function CloseFlow({busy, onClose, onBack}: {
  busy: boolean;
  onClose: (comment: string) => void;
  onBack: () => void;
}) {
  const [comment, setComment] = useState('');
  const [sure, setSure] = useState(false);
  return (
    <>
      <Title note="После закрытия смена уходит в отчёт и правится только администратором.">
        Закрытие смены
      </Title>
      <div className="body">
        <Card>
          <CardBody>
            <Field label="Что передать следующей смене">
              <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
            </Field>
          </CardBody>
        </Card>
        <Pick box on={sure} onClick={() => setSure((value) => !value)}>
          Выработка записана полностью, замечания внесены
        </Pick>
        <Button disabled={busy || !sure} onClick={() => onClose(comment.trim())}>
          {busy ? 'Закрываем…' : 'Закрыть смену'}
        </Button>
        <Button tone="ghost" onClick={onBack}>Назад</Button>
      </div>
    </>
  );
}
