import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BigButton, Panel, PanelTitle, Screen } from './ui';

/**
 * Рамка рабочего места на всю ОСТАВШУЮСЯ высоту, а не на всю высоту окна.
 *
 * ПОЧЕМУ НЕ `min-h-dvh`. Над рабочим местом стоит липкая шапка приложения, и
 * она занимает место в потоке. `100dvh` под ней давало страницу ровно на высоту
 * шапки длиннее окна — на каждом экране машиниста висела прокрутка на 76 px,
 * даже когда содержимое помещалось целиком (жалоба 16.09.2026).
 *
 * Высоту шапки замеряем, а не записываем числом: на широком экране её нет
 * вовсе (там боковое меню), а на телефоне к ней добавляется безопасная зона
 * выреза — константа врала бы в обе стороны.
 */
export function OperatorFrame({children}: {children: ReactNode}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      const node = frame.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top + window.scrollY;
      setOffset(Math.max(0, Math.round(top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div
      ref={frame}
      // До замера — прежняя высота: лучше лишняя прокрутка на один кадр, чем
      // экран, схлопнувшийся по содержимому.
      style={{minHeight: offset === null ? undefined : `calc(100dvh - ${offset}px)`}}
      className={[
        'operator-mobile-theme mx-auto flex max-w-[560px] flex-col overflow-x-hidden',
        offset === null ? 'min-h-dvh' : '',
        'bg-[#f2f4f6] text-[#16212b] md:border-x md:border-[#d4dbe1] md:shadow-2xl',
        '[&_.operator-screen]:min-h-0 [&_.operator-screen]:flex-1 [&_.operator-screen]:bg-transparent',
        '[&_.operator-screen-header]:border-b-0 [&_.operator-screen-header]:pb-2',
        '[&_.operator-panel]:border-[#d7dde3] [&_.operator-panel]:shadow-[0_3px_14px_rgba(15,23,42,0.06)]',
        '[&_.operator-fact]:border-[#e1e6ea]',
        '[&_.operator-screen-footer]:border-[#ced6dd] [&_.operator-screen-footer]:bg-white/95',
        '[&_.operator-tab-bar]:border-[#dce2e7] [&_.operator-tab-bar]:bg-white',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

/**
 * Работа или сдача, а смены в состоянии нет.
 *
 * Раньше это была голая строка «Смена не найдена.» — тупик без выхода и без
 * объяснения (аудит R76, находки 23 и 26). Причина у состояния без смены ровно
 * одна: смену закрыли на другом устройстве, и сервер отдаёт факты уже без неё.
 * Поэтому говорим об этом прямо и даём перечитать состояние — тот же `reload`,
 * что у экрана «Нет связи».
 */
export function ShiftMissingScreen({onReload}: {onReload: () => void}) {
  return (
    <Screen title="Смена" footer={<BigButton onClick={onReload}>Обновить</BigButton>}>
      <Panel>
        <PanelTitle>Смена не найдена.</PanelTitle>
        <p className="mt-1 text-sm text-muted-foreground">Смену могли закрыть на другом устройстве.</p>
      </Panel>
    </Screen>
  );
}
