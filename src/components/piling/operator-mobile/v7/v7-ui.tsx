'use client';

import type {ReactNode} from 'react';
import {PilingIcon, type PilingIconName} from '@/components/piling/icons';

/**
 * Каркас экранов v7: хром телефона, карточки, строки, поля, кнопки.
 *
 * Перенос визуального языка макета `docs/operator-module/` в React — тот же
 * набор элементов, из которых собраны все 36 экранов визуализации. Логики
 * смены здесь нет: каркас отвечает за то, КАК показано, экраны — за то, ЧТО.
 */

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

const CHIP_CLASS: Record<Tone, string> = {
  ok: 'chip ok', warn: 'chip warn', bad: 'chip bad', info: 'chip info', muted: 'chip',
};

/* ------------------------------------------------------------ хром --- */

/** Шапка: возврат слева, состояние связи и время синхронизации справа. */
export function NavBar({back, onBack, online, syncedAt, pending}: {
  back: string;
  onBack?: () => void;
  online: boolean;
  syncedAt: string | null;
  pending: number;
}) {
  return (
    <div className="navbar">
      {onBack ? (
        <button type="button" className="back" onClick={onBack}><PilingIcon name="back" size={14} decorative />{back}</button>
      ) : <span className="back">{back}</span>}
      <span className="sync">
        <span className="st"><span className={online ? 'dot' : 'dot off'} />{online ? 'Онлайн' : 'Офлайн'}</span>
        <span className="sd">
          {pending > 0
            ? `Будет синхронизировано: ${pending}`
            : (syncedAt ? `Синхронизировано ${syncedAt}` : 'Синхронизация…')}
        </span>
      </span>
    </div>
  );
}

export function Title({children, note}: {children: ReactNode; note?: ReactNode}) {
  return (
    <div className="title">
      <h1>{children}</h1>
      {note ? <p>{note}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------- карточки --- */

export function Card({title, children}: {title?: string; children: ReactNode}) {
  return (
    <section className="card">
      {title ? <div className="ct">{title}</div> : null}
      {children}
    </section>
  );
}

export function CardBody({children}: {children: ReactNode}) {
  return <div className="cb">{children}</div>;
}

export function Chip({tone = 'muted', children}: {tone?: Tone; children: ReactNode}) {
  return <span className={CHIP_CLASS[tone]}>{children}</span>;
}

/**
 * Строка списка. С `onClick` становится кнопкой — иначе это просто строка, и
 * заворачивать её в кнопку значило бы обещать нажатие, которого нет.
 */
export function Row({state = 'idle', mark, title, note, chip, onClick, disabled}: {
  state?: 'idle' | 'done' | 'now';
  mark?: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  chip?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const inner = (
    <>
      {mark === undefined ? null : <span className="num">{mark}</span>}
      <span className="rb">
        <span className="t">{title}</span>
        {note ? <span className="s">{note}</span> : null}
      </span>
      {chip}
      {onClick ? <span className="caret" aria-hidden="true">›</span> : null}
    </>
  );
  if (!onClick) return <div className={`row ${state}`}>{inner}</div>;
  return (
    <button type="button" className={`row ${state}`} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

export function Banner({tone, title, note, action}: {
  tone: Tone; title: ReactNode; note?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={`banner ${tone === 'muted' ? '' : tone}`}>
      <PilingIcon name={tone === 'ok' ? 'check' : tone === 'bad' ? 'risk' : tone === 'warn' ? 'defect' : 'documents'} size={16} decorative />
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

/* -------------------------------------------------------------- поля --- */

/** Выбор одного варианта либо отметка — кружок и квадрат из макета. */
export function Pick({on, box, onClick, children}: {
  on: boolean; box?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`pick ${box ? 'box' : ''} ${on ? 'on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className="mark" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

export function Field({label, children}: {label: string; children: ReactNode}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Button({tone = 'primary', disabled, onClick, children}: {
  tone?: 'primary' | 'ghost' | 'soft' | 'danger';
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const cls = tone === 'primary' ? 'btn' : `btn ${tone}`;
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------ нижнее меню --- */

/**
 * Нижнее меню. Состав задаёт модуль, а не каркас: у машиниста пять разделов со
 * сменой, у помощника смены нет вовсе. Одна карта на оба списка развалилась бы
 * при первом же расхождении.
 *
 * `mid` — приподнятая центральная кнопка из макета. Она ровно одна: две
 * приподнятые кнопки перестают быть главными.
 */
export interface DockItem<K extends string> {
  key: K;
  label: string;
  glyph: string;
  mid?: boolean;
}

/**
 * Нижнее меню: четыре раздела, один набор во всех модулях оператора.
 *
 * ПОЧЕМУ ЧЕТЫРЕ. Палец в рукавице — около 20 мм. На экране 375 px пять кнопок
 * дают по 75 px, четыре — по 94 px; это разница между «попал» и «попал не
 * туда». Прежние «Задания» и «Журнал» вкладок не заслужили: учёт выработки
 * относится к смене и уехал в «Смену», журнал открывают раз в день — он в
 * «Ещё».
 */
export const OPERATOR_DOCK = [
  {key: 'HOME', label: 'Смена', glyph: '⌂'},
  {key: 'SAFETY', label: 'ТБ', glyph: '⛨', mid: true},
  {key: 'EQUIP', label: 'Техника', glyph: '⚙'},
  {key: 'MORE', label: 'Ещё', glyph: '⋯'},
] as const satisfies readonly DockItem<string>[];

export type DockTab = (typeof OPERATOR_DOCK)[number]['key'];

const DOCK_ICONS: Record<string, PilingIconName> = {
  HOME: 'home', SAFETY: 'accepted', EQUIP: 'equipment-rig', EQUIPMENT: 'equipment-rig',
  MORE: 'menu', CLEARANCE: 'accepted', BRIEFINGS: 'documents', JOURNAL: 'history', HISTORY: 'history',
};

export function Dock<K extends string>({items, active, badges, onSelect}: {
  items: readonly DockItem<K>[];
  active: K;
  badges?: Partial<Record<K, number>>;
  onSelect: (tab: K) => void;
}) {
  return (
    <nav className="dock" style={{gridTemplateColumns: `repeat(${items.length}, 1fr)`}}>
      {items.map((tab) => {
        const count = badges?.[tab.key] ?? 0;
        return (
          <button
            key={tab.key}
            type="button"
            className={`${tab.mid ? 'mid ' : ''}${active === tab.key ? 'on' : ''}`}
            aria-current={active === tab.key ? 'page' : undefined}
            onClick={() => onSelect(tab.key)}
          >
            <span className="glyph"><PilingIcon name={DOCK_ICONS[tab.key] ?? 'documents'} size={24} decorative /></span>
            {tab.label}
            {count > 0 ? <span className="badge">{count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Корпус телефона: статус-бар, шапка, прокручиваемое тело, красная кнопка и
 * нижнее меню. Один на все операторские модули — иначе хром разойдётся между
 * экранами, и человек перестанет узнавать своё приложение.
 */
export function PhoneShell({online, syncedAt, pending, back, onBack, children, action, dock, desktopNav}: {
  online: boolean;
  syncedAt: string | null;
  pending: number;
  back?: string;
  onBack?: () => void;
  children: ReactNode;
  action?: ReactNode;
  dock?: ReactNode;
  desktopNav?: ReactNode;
}) {
  return (
    <div className={`stage ${desktopNav ? 'has-desktop-nav' : ''}`}>
      {desktopNav}
      <div className="device">
        <NavBar back={back ?? 'Оператор'} onBack={onBack} online={online} syncedAt={syncedAt} pending={pending} />
        <div className="viewport">{children}</div>
        {action ? <div className="incident">{action}</div> : null}
        {dock}
      </div>
    </div>
  );
}
