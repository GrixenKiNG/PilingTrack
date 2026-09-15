'use client';

import {useEffect, useState, type ReactNode} from 'react';
import './device-frame.css';

/**
 * Корпус телефона вокруг операторского экрана.
 *
 * ЧТО ОН ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ. Экран внутри не меняется: ни разметка, ни
 * поведение, ни его собственный заголовок с нижним меню. Обёртка добавляет
 * только корпус с вырезом и статус-бар — и только на широком экране (см.
 * `device-frame.css`). На телефоне она не делает ничего: там экран и так
 * полноэкранный, а нарисованный статус-бар лёг бы поверх системного.
 *
 * Поэтому её можно ставить и на боевой `/operator`: на устройстве, где он
 * работает, поведение остаётся прежним.
 */
export function DeviceFrame({children}: {children: ReactNode}) {
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="opdev">
      <div className="opdev-body">
        {/* Часы настоящие: время в шапке, врущее на полсмены, — первое, чему
            человек перестаёт верить. До первого тика пусто, а не «9:41»:
            подставленное время успело бы мелькнуть и запомниться. */}
        <div className="opdev-status" aria-hidden="true">
          <span>{clock}</span>
          <span className="icons">
            <span className="bars"><i /><i /><i /><i /></span>
            <span className="battery"><i /></span>
          </span>
        </div>
        <div className="opdev-host">{children}</div>
        {/* Полоса жеста — низ корпуса. На телефоне скрыта вместе с рамкой. */}
        <div className="opdev-home" aria-hidden="true"><i /></div>
      </div>
    </div>
  );
}
