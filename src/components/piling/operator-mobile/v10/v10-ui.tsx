'use client';

import type {ReactNode} from 'react';
import {PilingIcon, type PilingIconName} from '@/components/piling/icons/piling-icon';

/**
 * Каркас экрана v10: шапка телефона, строки, карточки, нижнее меню.
 *
 * ИКОНКИ — ИЗ ОСНОВНОГО ПРИЛОЖЕНИЯ. Здесь нет ни одного своего SVG: всё идёт
 * через `PilingIcon`, тот же набор, что в остальных разделах. Раньше у v10 был
 * собственный набор из 33 контуров — он рисовал сваю и молот не так, как их
 * рисует приложение, и человек, переходя между разделами, видел два разных
 * языка значков.
 *
 * Карта ниже переводит смысловые имена экрана в имена набора. Она нужна именно
 * как карта: смысл на экране («топливо», «блокирующие») и имя ресурса — разные
 * вещи, и подстановка имени прямо в разметку связала бы экран с набором
 * намертво.
 *
 * ЧЕГО В НАБОРЕ НЕТ: значка погоды и осадков. Их на эталоне два (облако и
 * зонт), в приложении — ни одного. Рисовать свои я не стал: строки погоды
 * сделаны парами «подпись — значение» без значка. Если нужен свой значок —
 * это отдельное решение, его надо утверждать, а не протаскивать молча.
 */

const ICONS: Record<string, PilingIconName> = {
  home: 'home',
  work: 'shift-start',
  equip: 'equipment-rig',
  report: 'reports',
  more: 'menu',
  safety: 'accepted',
  shield: 'accepted',
  check: 'check',
  pin: 'site',
  chevL: 'back',
  chev: 'external',
  bell: 'notifications',
  doc: 'documents',
  clock: 'engine-hours',
  fuel: 'fuel',
  camera: 'camera',
  drill: 'drilling-auger',
  pile: 'pile-driving',
  warning: 'defect',
  wrench: 'repair',
  oil: 'maintenance-due',
  clean: 'inspection',
  box: 'spare-parts',
  list: 'documents',
  minus: 'risk',
  user: 'operator',
  refresh: 'refresh',
  downtime: 'downtime',
  handoff: 'handoff',
  inspect: 'inspection',
};

/**
 * Значок нужного размера.
 *
 * `PilingIcon` увеличивает переданный размер в 1,5 раза — это общее правило
 * набора (`PILING_ICON_SCALE`). Здесь размер задаётся в пикселях КАК НА ЭКРАНЕ,
 * а деление берёт эту особенность на себя: иначе каждый вызов пришлось бы
 * писать «18, но на самом деле 12».
 */
export function Icon({name, size = 20}: {name: string; size?: number}) {
  const resolved = ICONS[name] ?? 'documents';
  return <PilingIcon name={resolved} size={size / 1.5} decorative />;
}

export interface ScreenTab {
  key: string;
  title: string;
  icon: string;
  screen: string;
}

/**
 * Статус-бар телефона: время настоящее, а не «10:42» из макета.
 *
 * Часы в шапке, врущие на полсмены, — первое, чему человек перестаёт верить.
 * До первого тика строка пустая: подставленное время успело бы мелькнуть.
 */
export function StatusBar({time}: {time: string}) {
  return (
    <div className="ov10-status">
      <span>{time}</span>
      <span className="icons" aria-hidden="true">
        <span className="bar" style={{height: 6}} />
        <span className="bar" style={{height: 8}} />
        <span className="bar" style={{height: 10}} />
        <span className="bar" style={{height: 12}} />
        <span style={{width: 7}} />
        <span className="batt"><i /></span>
      </span>
    </div>
  );
}

export function Navbar({title, sub, right, onBack}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="ov10-nav">
      <div className="row">
        {onBack
          ? (
            <button type="button" className="iconbtn" onClick={onBack} aria-label="Назад">
              <Icon name="chevL" size={20} />
            </button>
          )
          : <span style={{width: 30, flex: '0 0 auto'}} />}
        <span className="ttl">{title}</span>
        {right ?? <span style={{width: 30, flex: '0 0 auto'}} />}
      </div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function Tabbar({tabs, active, onSelect}: {
  tabs: ScreenTab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <nav className="ov10-tabs" style={{gridTemplateColumns: `repeat(${tabs.length}, 1fr)`}}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          data-tab={tab.key}
          aria-current={tab.key === active ? 'page' : undefined}
          className={tab.key === active ? 'on' : ''}
          onClick={() => onSelect(tab.key)}
        >
          <Icon name={tab.icon} size={22} />
          <span>{tab.title}</span>
        </button>
      ))}
    </nav>
  );
}

export function Card({title, children}: {title?: string; children: ReactNode}) {
  return (
    <div className="ov10-card">
      {title ? <div className="ov10-card-title">{title}</div> : null}
      {children}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'orange' | '';

export function Row({icon, tone, title, note, chevron, onClick}: {
  icon: string;
  tone?: Tone;
  title: string;
  note?: string;
  chevron?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={`ic ${tone ?? ''}`}><Icon name={icon} size={23} /></span>
      <span className="body">
        <span className="t">{title}</span>
        {note ? <span className="s">{note}</span> : null}
      </span>
      {chevron ? <span className="chev"><Icon name="chev" size={16} /></span> : null}
    </>
  );
  if (onClick) {
    return <button type="button" className="ov10-row" onClick={onClick}>{content}</button>;
  }
  return <div className="ov10-row">{content}</div>;
}

export function Badge({tone, children}: {tone: 'ok' | 'warn' | 'bad' | 'info' | 'gray'; children: ReactNode}) {
  return <span className={`ov10-badge ${tone}`}>{children}</span>;
}

export function Metric({label, value, note, up}: {label: string; value: string; note?: string; up?: boolean}) {
  return (
    <div className="ov10-metric">
      <div className="ml">{label}</div>
      <div className="mv">{value}</div>
      {note ? <div className={`ms${up ? ' up' : ''}`}>{note}</div> : null}
    </div>
  );
}

export function Pair({label, value, warn}: {label: string; value: string; warn?: boolean}) {
  return (
    <div className="ov10-pair">
      <span className="k">{label}</span>
      <span className={`v${warn ? ' warn' : ''}`}>{value}</span>
    </div>
  );
}

export function Banner({tone, title, children}: {tone: 'info' | 'warn' | 'bad'; title: string; children?: ReactNode}) {
  return (
    <div className={`ov10-banner ${tone}`}>
      <span><Icon name={tone === 'bad' ? 'warning' : 'list'} size={18} /></span>
      <span><b>{title}</b>{children}</span>
    </div>
  );
}

/** Пустое место данных. Показываем прочерк словами, а не выдуманное значение. */
export function Nodata({children}: {children: ReactNode}) {
  return <div className="ov10-nodata">{children}</div>;
}
