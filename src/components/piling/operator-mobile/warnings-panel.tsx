'use client';

import {useState} from 'react';
import {ChevronDown, ChevronRight} from 'lucide-react';
import type {WorkWarning} from '@/modules/operator-mobile/contracts';
import {Panel, PanelTitle, Sign} from './ui';

const TONE = {
  STOP: 'danger',
  ALERT: 'danger',
  NOTE: 'warning',
} as const;

const CAPTION = {
  STOP: 'Критическое предупреждение',
  ALERT: 'Нарушение · видит диспетчер',
  NOTE: 'К сведению',
} as const;

/**
 * Предупреждения смены. Показываются на каждом экране, а не только там, где
 * возникли: оператор должен видеть причину в тот момент, когда она может на
 * что-то повлиять, а не искать её на предыдущем шаге.
 *
 * Ничего не «снимается» вручную: список пересчитывается при каждом чтении
 * экрана из открытых дефектов и текущей погоды. Механик закрыл дефект —
 * предупреждение исчезло само.
 */
export function WarningsPanel({warnings}: {warnings: WorkWarning[]}) {
  const [openNotes, setOpenNotes] = useState(false);
  if (warnings.length === 0) return null;

  /*
    Тревожные предупреждения раскрыты всегда, «к сведению» — свёрнуты.

    Уровни здесь не равны: STOP и ALERT требуют решения прямо сейчас, NOTE
    сообщает о том, про что механик уже знает и что действий не требует.
    Разворачивать их одинаково значило отдавать треть экрана приёмки под
    «обогреватель не работает, механик знает» — и отодвигать вниз то, ради чего
    экран открыт. Свёрнутая строка называет число и раскрывается нажатием;
    спрятать её совсем нельзя — это по-прежнему предупреждение.
  */
  const alarming = warnings.filter((warning) => warning.level !== 'NOTE');
  const notes = warnings.filter((warning) => warning.level === 'NOTE');

  return (
    <div className="space-y-2.5">
      {alarming.map((warning) => (
        <Panel key={warning.code} tone={TONE[warning.level]}>
          <div className="flex gap-3">
            <Sign tone="danger" />
            <div className="min-w-0 flex-1">
              <p className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">
                {CAPTION[warning.level]}
              </p>
              <PanelTitle tone={TONE[warning.level]}>{warning.title}</PanelTitle>
              <p className="mt-1 text-sm">{warning.detail}</p>
              <p className="mt-2 text-sm font-medium">{warning.resolution}</p>
            </div>
          </div>
        </Panel>
      ))}

      {notes.length > 0 ? (
        <Panel tone="warning">
          <button
            type="button"
            onClick={() => setOpenNotes((value) => !value)}
            aria-expanded={openNotes}
            className="flex w-full items-center gap-3 text-left"
          >
            <Sign tone="warning" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-snug">
                К сведению: {notes.length}
              </span>
              <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                {notes.map((warning) => warning.title).join(' · ')}
              </span>
            </span>
            {openNotes
              ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          </button>

          {openNotes ? (
            <ul className="mt-2 space-y-2">
              {notes.map((warning) => (
                <li key={warning.code} className="border-t pt-2 first:border-t-0 first:pt-0">
                  <p className="text-sm font-semibold">{warning.title}</p>
                  <p className="mt-0.5 text-2xs">{warning.detail}</p>
                  <p className="mt-1 text-2xs font-medium">{warning.resolution}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
