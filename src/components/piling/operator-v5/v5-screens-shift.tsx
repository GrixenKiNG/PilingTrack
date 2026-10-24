import { timeRu, dateRu, Rowline } from "./v5-shared";
import { useState } from 'react';
import type { ChecklistView, IncidentCategory, IncidentSign, OperatorAnswer, OperatorMobileState } from '@/modules/operator-mobile';
import { INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS, INCIDENT_DESCRIPTION_MIN, INCIDENT_SIGN_LABELS, INCIDENT_SIGNS, measureRequired } from '@/modules/operator-mobile/client';
import {formatNumber} from '@/lib/format';

/** C. Приёмка машины — экран C2 макета. */
export function AcceptScreen({state, busy, onAccept}: {
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
          {state.blockedShift?.equipmentId === option.equipmentId ? (
            <p className="note warn" tabIndex={-1} data-next-target={options.every((entry) => entry.equipmentId === state.blockedShift?.equipmentId)}>
              Другой машинист не сдал смену за {dateRu(state.blockedShift.productionDate)}.
              {' '}Обратитесь к диспетчеру, чтобы он организовал сдачу смены. После её закрытия можно принять машину.
            </p>
          ) : null}
          <button
            className="b"
            type="button"
            data-next-target="true"
            disabled={busy || state.blockedShift?.equipmentId === option.equipmentId}
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
export function ChecklistScreen({checklist, answers, measures, notes, media, uploading, photoErrors, busy, lastMeter, meterReplaced, onMeterReplacement, onAnswer, onMeasure, onNote, onPhoto, onSubmit}: {
  checklist: ChecklistView;
  answers: Record<string, OperatorAnswer>;
  measures: Record<string, string>;
  notes: Record<string, string>;
  media: Record<string, string[]>;
  uploading: Record<string, boolean>;
  photoErrors: Record<string, string>;
  busy: boolean;
  /** Последнее показание счётчика — подсказка у поля моточасов. */
  lastMeter: {engineHours: number; recordedAt: string} | null;
  meterReplaced: boolean;
  onMeterReplacement: (replaced: boolean) => void;
  onAnswer: (itemId: string, answer: OperatorAnswer) => void;
  onMeasure: (key: string, value: string) => void;
  onNote: (itemId: string, value: string) => void;
  onPhoto: (itemId: string, file: File) => Promise<void>;
  onSubmit: () => void;
}) {
  // «Долил за смену» необязателен: в счёт «осталось отметить» и в полоску хода не идёт.
  const items = checklist.sections.flatMap((section) => section.items).filter((item) => !item.topUp);
  // Замер обязателен при таком ответе — без него сервер список не примет.
  const needsMeasure = (item: (typeof items)[number]) => Boolean(item.measure) && !item.topUp
    && measureRequired(item, answers[item.id] ?? 'OK');
  const isIssue = (itemId: string) => answers[itemId] === 'REMARK' || answers[itemId] === 'FAULT';
  const left = items.filter(
    (item) => !answers[item.id]
      || (needsMeasure(item) && !(measures[item.measure?.key ?? ''] ?? '').trim())
      || (isIssue(item.id) && (!(notes[item.id] ?? '').trim()
        || (item.photoOnIssue && !(media[item.id]?.length)) || uploading[item.id])),
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
            {section.items.filter((item) => !item.topUp).map((item) => (
              <div className="rowline" key={item.id}>
                <span>
                  {item.severity === 'ALERT' ? <span className="crit">! </span> : null}
                  {item.text}
                  {item.hint ? <><br /><span className="r">{item.hint}</span></> : null}
                </span>
                <span className="ans">
                  <button
                    type="button"
                    data-next-target={!answers[item.id]}
                    className={answers[item.id] === 'OK' ? 'on' : ''}
                    onClick={() => onAnswer(item.id, 'OK')}
                  >
                    Норма
                  </button>
                  <button
                    type="button"
                    className={answers[item.id] === 'REMARK' ? 'on' : ''}
                    onClick={() => onAnswer(item.id, 'REMARK')}
                  >
                    Замечание
                  </button>
                  <button
                    type="button"
                    className={answers[item.id] === 'FAULT' ? 'bad' : ''}
                    onClick={() => onAnswer(item.id, 'FAULT')}
                  >
                    Отказ
                  </button>
                </span>
              </div>
            ))}
            {section.items.filter((item) => isIssue(item.id)).map((item) => (
              <div className="card" key={item.id + '-issue'}>
                <label>
                  <span className="lbl">Что именно не так: {item.text}</span>
                  <textarea value={notes[item.id] ?? ''} rows={2} data-next-target={!(notes[item.id] ?? '').trim()}
                    onChange={(event) => onNote(item.id, event.target.value)} />
                </label>
                {item.photoOnIssue ? (
                  <>
                    <label>
                      <span className="lbl">Снимок: {item.text}</span>
                      <input type="file" accept="image/*" capture="environment" disabled={busy || uploading[item.id]}
                        data-next-target={!media[item.id]?.length}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) void onPhoto(item.id, file);
                        }} />
                    </label>
                    <p className="m">{uploading[item.id] ? 'Загружаем снимок…' : `Снимков: ${media[item.id]?.length ?? 0}`}</p>
                    {photoErrors[item.id] ? <p role="alert" className="note warn">{photoErrors[item.id]}</p> : null}
                  </>
                ) : null}
              </div>
            ))}
            {section.items.some((item) => item.topUp) ? (
              <div className="card">
                <span className="lbl">Долил за смену</span>
                <p className="m">Если не доливали, оставьте пустым</p>
                {section.items.filter((item) => item.topUp).map((item) => (
                  <label className="rowline" key={item.id}>
                    <span>{item.text}</span>
                    <input
                      inputMode="decimal"
                      aria-label={`${item.text}, ${item.measure?.unit ?? 'л'}`}
                      placeholder="0"
                      value={measures[item.measure?.key ?? ''] ?? ''}
                      onChange={(event) => onMeasure(item.measure?.key ?? '', event.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : null}
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
                  data-next-target={!(measures[item.measure?.key ?? ''] ?? '').trim()}
                  value={measures[item.measure?.key ?? ''] ?? ''}
                  onChange={(event) => onMeasure(item.measure?.key ?? '', event.target.value)}
                />
                {/* Прошлое показание счётчика — рядом с полем, а не на экране
                    приёмки, который к этому моменту давно закрыт. Без отметки
                    замены меньшее число отклоняется: человек может заметить
                    опечатку или подтвердить замену до отправки. Поле при
                    этом не заполняем: подставленное отправят не глядя. */}
                {item.measure?.key === 'engineHours' && lastMeter ? (
                  <span className="m">
                    было {formatNumber(lastMeter.engineHours, 0)} м/ч
                    {' '}на {dateRu(lastMeter.recordedAt)}
                  </span>
                ) : null}
                {item.measure?.key === 'engineHours' ? (
                  <label className="m">
                    <input type="checkbox" checked={meterReplaced} onChange={(event) => onMeterReplacement(event.target.checked)} />
                    Счётчик заменён
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        <button
          className={left > 0 ? 'b dis' : 'b'}
          type="button"
          data-next-target={left === 0}
          disabled={busy || left > 0 || Object.values(uploading).some(Boolean)}
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
export function IncidentScreen({state, busy, onReport}: {
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
