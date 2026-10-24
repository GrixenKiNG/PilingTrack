import { type ReactNode } from 'react';
import {PilingIcon, type PilingIconName} from '@/components/piling/icons';
import type { OperatorMobileState } from '@/modules/operator-mobile';

/**
 * Рабочее место машиниста по макету v5 — на живых данных.
 *
 * ЧТО БЫЛО ЗДЕСЬ РАНЬШЕ. Тридцать четыре экрана макета, перенесённые дословно:
 * разметка без единого обработчика, переходы по подписям кнопок и данные из
 * документа — Сидоров А. В., Liebherr LRH 100, наряд № 118. Посмотреть путь
 * было можно, работать — нет: ни одного запроса к серверу модуль не делал.
 *
 * ЧТО ЗДЕСЬ СЕЙЧАС. Тот же визуальный язык (те же классы и те же экраны по
 * фазам смены) поверх настоящего состояния из `/api/operator/mobile/state`.
 * Источник данных и команды общие с `/operator`: сервер один, и правила
 * приёмки записи тоже одни. Своих маршрутов у модуля нет.
 *
 * ЧЕГО НЕТ И ПОЧЕМУ. Экрана «Вход по коду» из макета: входа по четырёхзначному
 * коду в продукте не существует, машинист уже вошёл своей учётной записью.
 * Нарисовать клавиатуру, которая ничего не проверяет, значило бы показать
 * защиту там, где её нет. Настоящий PIN — отдельное решение о том, как в поле
 * подтверждают личность, и принимается оно не в разметке макета.
 */

export type Tab = 'SHIFT' | 'WORK' | 'DEFECTS' | 'EVENTS' | 'MORE';

const DASH = '—';

export function timeRu(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
}

export function dateRu(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleDateString('ru-RU');
}

/* ------------------------------------------------------------- каркас --- */

export function Bar({online}: {online: boolean}) {
  return (
    <div className="bar">
      <span>
        <span className={online ? 'dot' : 'dot off'} />
        {online ? 'На связи' : 'Без связи'}
      </span>
      <span>{new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</span>
    </div>
  );
}

export function Top({state}: {state: OperatorMobileState}) {
  const {assignment} = state;
  if (!assignment) return null;
  return (
    <div className="top">
      <span className="mach">{assignment.equipmentName}</span>
      <span className="where">{assignment.siteName} · {state.operator.name}</span>
    </div>
  );
}

export function Dock({active, onSelect, extra}: {
  active: Tab;
  onSelect: (tab: Tab) => void;
  /** Лишняя ячейка меню (кнопка «Следующий шаг») — встаёт после вкладки `after`. */
  extra?: {after: Tab; node: ReactNode};
}) {
  const tabs: {key: Tab; label: string; icon: PilingIconName}[] = [
    {key: 'SHIFT', label: 'Смена', icon: 'home'},
    {key: 'WORK', label: 'Работа', icon: 'pile-driving'},
    {key: 'DEFECTS', label: 'Дефекты', icon: 'defect'},
    {key: 'EVENTS', label: 'ЧП', icon: 'risk'},
    {key: 'MORE', label: 'Ещё', icon: 'menu'},
  ];
  return (
    <div className="dock" style={extra ? {gridTemplateColumns: tabs.flatMap((tab) => (extra.after === tab.key ? ['minmax(0, 1fr)', 'minmax(0, 1.6fr)'] : ['minmax(0, 1fr)'])).join(' ')} : undefined}>
      {tabs.flatMap((tab) => [
        <button
          key={tab.key}
          type="button"
          className={tab.key === active ? 'on' : ''}
          aria-current={tab.key === active ? 'page' : undefined}
          onClick={() => onSelect(tab.key)}
        >
          <PilingIcon name={tab.icon} size={24} decorative />
          {tab.label}
        </button>,
        ...(extra && extra.after === tab.key
          ? [<div key="next-step" style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4}}>{extra.node}</div>]
          : []),
      ])}
    </div>
  );
}

export function Rowline({label, note, badge, tone, onClick}: {
  label: string;
  note?: string;
  badge?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'good';
  /** Задан — строка становится кнопкой. Без него это просто запись. */
  onClick?: () => void;
}) {
  const body = (
    <>
      <span>
        {label}
        {note ? <><br /><span className="r">{note}</span></> : null}
      </span>
      {badge ? <span className={tone ? `badge ${tone}` : 'badge'}>{badge}</span> : null}
    </>
  );
  if (!onClick) return <div className="rowline">{body}</div>;
  return (
    <button type="button" className="rowline tap" onClick={onClick}>{body}</button>
  );
}
