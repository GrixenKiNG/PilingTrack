'use client';

import {useState} from 'react';
import type {ProductionEntryView} from '@/modules/operator-mobile/contracts';
import {formatDowntimeHoursOnly} from '@/lib/downtime-hours';
import {Card} from './v10-ui';

export interface CorrectionInput {
  entryId: string;
  kind: ProductionEntryView['kind'];
  actual: number;
  reason: string;
}

const KIND_UNIT: Record<ProductionEntryView['kind'], string> = {PILES: 'шт', DRILLING: 'шт', DOWNTIME: 'ч'};

const KIND_QUESTION: Record<ProductionEntryView['kind'], string> = {
  PILES: 'Сколько свай было на самом деле',
  DRILLING: 'Сколько скважин было на самом деле',
  DOWNTIME: 'Сколько часов простоя было на самом деле',
};

/**
 * Записанное за смену и поправка ошибки ввода.
 *
 * Тот же порядок, что у боевого экрана (`screens/entries-list.tsx`): поправка
 * ложится отдельной строкой рядом с исходной, а не стирает её; машинист вводит
 * итог («сколько было на самом деле»), разницу считает сервер. Без этого блока
 * в v10 ошибочный простой исправить было нечем, а закрытие смены не пускает
 * простой больше самой смены (аудит 11–13.10.2026, пункт 5).
 */
export function V10Entries({entries, busy, onCorrect}: {
  entries: ProductionEntryView[];
  busy: boolean;
  onCorrect: (input: CorrectionInput) => Promise<boolean>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState('');

  if (entries.length === 0) return null;

  const close = () => {
    setOpenId(null);
    setActual('');
    setReason('');
  };

  const ready = actual.trim() !== '' && reason.trim().length >= 3;

  const submit = async (entry: ProductionEntryView) => {
    // Пустая строка — не ноль: `Number('')` даёт 0, и «ничего не ввёл» стало бы «нисколько».
    if (!ready) return;
    const fixed = await onCorrect({
      entryId: entry.id,
      kind: entry.kind,
      actual: Number(actual.replace(',', '.')),
      reason: reason.trim(),
    });
    if (fixed) close();
  };

  return (
    <Card title="Записано за смену">
      {entries.map((entry) => (
        <div key={entry.id} className="ov10-entry">
          <div className="ov10-entry-head">
            <span>{entry.label}</span>
            <b>
              {entry.kind === 'DOWNTIME'
                ? formatDowntimeHoursOnly(entry.value)
                : `${entry.value} ${KIND_UNIT[entry.kind]}`}
              {entry.meters !== null ? ` · ${entry.meters.toFixed(1)} м.п.` : ''}
            </b>
          </div>
          {entry.corrections.map((correction) => (
            <p key={correction.at} className="ov10-entry-note">
              Поправка {correction.delta > 0 ? `+${correction.delta}` : correction.delta} · {correction.note}
            </p>
          ))}
          {openId === entry.id ? (
            <>
              <label className="ov10-field">
                <span className="lab">{KIND_QUESTION[entry.kind]}</span>
                <input inputMode="decimal" value={actual} onChange={(event) => setActual(event.target.value)} />
              </label>
              <label className="ov10-field">
                <span className="lab">Что случилось</span>
                <input value={reason} placeholder="Ошибся при вводе" onChange={(event) => setReason(event.target.value)} />
              </label>
              <button type="button" className="ov10-btn" disabled={busy || !ready} onClick={() => void submit(entry)}>
                {busy ? 'Записываем…' : 'Записать поправку'}
              </button>
              <button type="button" className="ov10-btn ghost" onClick={close}>Отмена</button>
            </>
          ) : (
            <button
              type="button"
              className="ov10-entry-fix"
              onClick={() => { setOpenId(entry.id); setActual(''); setReason(''); }}
            >
              Поправить
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}
