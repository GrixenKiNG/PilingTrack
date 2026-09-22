'use client';

import {useState} from 'react';
import type {ProductionEntryView} from '@/modules/operator-mobile/contracts';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {BigButton, Panel, PanelTitle} from '../ui';

const KIND_UNIT: Record<ProductionEntryView['kind'], string> = {
  PILES: 'шт',
  DRILLING: 'шт',
  // Простой печатается своим форматом — часами и минутами, а не дробью.
  DOWNTIME: 'ч',
};

const KIND_QUESTION: Record<ProductionEntryView['kind'], string> = {
  PILES: 'Сколько свай было на самом деле',
  DRILLING: 'Сколько скважин было на самом деле',
  DOWNTIME: 'Сколько часов простоя было на самом деле',
};

/**
 * Записанное за смену — и возможность поправить ошибку.
 *
 * ПОЧЕМУ НЕ УДАЛЕНИЕ. Стёртая запись не оставляет следа: через неделю по
 * журналу нельзя отличить ошибку ввода от подчищенной смены. Поправка кладётся
 * отдельной строкой рядом с исходной, и обе видны здесь же.
 *
 * ПОЧЕМУ СПРАШИВАЕМ ИТОГ, А НЕ РАЗНИЦУ. Человек, вбивший 15 вместо 5, знает
 * пятёрку. Разницу посчитает сервер — просить машиниста вычитать в уме значит
 * получить вторую ошибку поверх первой.
 */
export function EntriesList({entries, busy, onCorrect}: {
  entries: ProductionEntryView[];
  busy: boolean;
  onCorrect: (input: {
    entryId: string; kind: ProductionEntryView['kind']; actual: number; reason: string;
  }) => Promise<boolean>;
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

  const submit = async (entry: ProductionEntryView) => {
    // Пустая строка — это не ноль. Number('') даёт 0, и без этой проверки
    // «ничего не ввёл» превращалось бы в «на самом деле нисколько».
    if (actual.trim() === '' || reason.trim().length < 3) return;
    const fixed = await onCorrect({
      entryId: entry.id,
      kind: entry.kind,
      actual: Number(actual.replace(',', '.')),
      reason: reason.trim(),
    });
    if (fixed) close();
  };

  return (
    <Panel>
      <PanelTitle>Записано за смену</PanelTitle>
      <ul className="mt-2 space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="border-t pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{entry.label}</span>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                {entry.kind === 'DOWNTIME'
                  ? formatDowntimeHours(entry.value)
                  : `${entry.value} ${KIND_UNIT[entry.kind]}`}
                {entry.meters !== null ? ` · ${entry.meters.toFixed(1)} м.п.` : ''}
              </span>
            </div>

            {entry.corrections.map((correction) => (
              <p key={correction.at} className="mt-1 text-2xs text-muted-foreground">
                Поправка {correction.delta > 0 ? `+${correction.delta}` : correction.delta}
                {' · '}
                {correction.note}
              </p>
            ))}

            {openId === entry.id ? (
              <div className="mt-2 space-y-2">
                <label className="block">
                  <span className="text-2xs font-medium text-muted-foreground">
                    {KIND_QUESTION[entry.kind]}
                  </span>
                  <input
                    inputMode="decimal"
                    value={actual}
                    onChange={(event) => setActual(event.target.value)}
                    className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
                  />
                </label>
                <label className="block">
                  <span className="text-2xs font-medium text-muted-foreground">Что случилось</span>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Ошибся при вводе"
                    className="mt-1 h-12 w-full rounded-md border bg-card px-3 text-base shadow-xs"
                  />
                </label>
                <BigButton
                  onClick={() => void submit(entry)}
                  disabled={busy || actual.trim() === '' || reason.trim().length < 3}
                >
                  {busy ? 'Записываем…' : 'Записать поправку'}
                </BigButton>
                <BigButton tone="ghost" onClick={close}>Отмена</BigButton>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {setOpenId(entry.id); setActual(''); setReason('');}}
                className="mt-1 min-h-11 text-2xs font-semibold text-signal underline-offset-2 hover:underline"
              >
                Поправить
              </button>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
