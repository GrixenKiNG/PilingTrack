'use client';

import type {ReactNode} from 'react';

/**
 * Каркас экранов v7: шапка, карточки, строки, чипы, баннеры.
 *
 * Это перенос визуального языка прототипа `docs/operator-module/` в React —
 * тот же набор элементов, из которых собраны все 36 макетов. Логики здесь нет
 * намеренно: экраны решают, что показать, каркас — только как.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

const CHIP_CLASS: Record<Tone, string> = {
  ok: 'chip ok', warn: 'chip warn', bad: 'chip bad', info: 'chip info', muted: 'chip',
};

export function Chip({tone = 'muted', children}: {tone?: Tone; children: ReactNode}) {
  return <span className={CHIP_CLASS[tone]}>{children}</span>;
}

export function Card({title, children}: {title?: string; children: ReactNode}) {
  return (
    <section className="card">
      {title ? <div className="ct">{title}</div> : null}
      {children}
    </section>
  );
}

/** Содержимое карточки колонкой — когда внутри не строки списка, а свёрстанный блок. */
export function CardBody({children}: {children: ReactNode}) {
  return <div className="cb">{children}</div>;
}

/**
 * Строка списка: номер или галочка слева, заголовок с подписью, чип справа.
 *
 * `state` — это не украшение: им размечены пройденные шаги допуска, текущий и
 * те, до которых человек ещё не дошёл.
 */
export function Row({state = 'idle', mark, title, note, chip}: {
  state?: 'idle' | 'done' | 'now';
  mark?: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <div className={`row ${state}`}>
      {mark === undefined ? null : <span className="num">{mark}</span>}
      <span className="rb">
        <span className="t">{title}</span>
        {note ? <span className="s">{note}</span> : null}
      </span>
      {chip}
    </div>
  );
}

export function Banner({tone, title, note, action}: {
  tone: Tone;
  title: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner ${tone === 'muted' ? '' : tone}`}>
      <div>
        <div className="bt">{title}</div>
        {note ? <div className="bs">{note}</div> : null}
        {action ? <div className="br">{action}</div> : null}
      </div>
    </div>
  );
}

export function Metric({value, label, extra}: {value: ReactNode; label: string; extra?: ReactNode}) {
  return (
    <div className="metric">
      <div className="mv">{value}</div>
      <div className="ml">{label}</div>
      {extra ? <div className="mx">{extra}</div> : null}
    </div>
  );
}

export function Pair({label, value}: {label: string; value: ReactNode}) {
  return (
    <div className="pair">
      <span className="pl">{label}</span>
      <span className="pv">{value}</span>
    </div>
  );
}

export function Empty({children}: {children: ReactNode}) {
  return <div className="empty">{children}</div>;
}
