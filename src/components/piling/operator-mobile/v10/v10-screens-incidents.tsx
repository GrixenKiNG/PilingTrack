import { timeRu, type Go } from "./v10-shared";
import { useState } from 'react';
import type { IncidentCategory, IncidentSign, OperatorMobileState } from '@/modules/operator-mobile';
import { INCIDENT_CATEGORIES, INCIDENT_CATEGORY_LABELS, INCIDENT_DESCRIPTION_MIN, INCIDENT_SIGN_LABELS, INCIDENT_SIGNS } from '@/modules/operator-mobile/client';
import {documentsSummary} from '../safety/documents-summary';
import { Card, Nodata, Row } from './v10-ui';

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
export function ScreenIncidents({state, busy, onReport}: {
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
              note={[`${timeRu(incident.occurredAt)} · ${incident.description}`,
                incident.reviewedAt ? `Разобрано${incident.reviewNote ? `: ${incident.reviewNote}` : ''}` : null,
              ].filter(Boolean).join(' · ')}
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
export function ScreenMore({state, go}: {state: OperatorMobileState; go: Go}) {
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
