import type { ComponentPropsWithoutRef } from 'react';

/**
 * Иконки производственных ролей, которых нет в наборе Lucide.
 *
 * Рисованы в грамматике Lucide намеренно: сетка 24×24, обводка `currentColor`
 * толщиной 2, скруглённые концы, без заливки. Поэтому они встают рядом с
 * остальными интерфейсными иконками и, в отличие от растрового набора
 * PilingTrack, наследуют цвет статуса — одна и та же иконка может быть
 * нейтральной в списке и аварийной на карточке.
 *
 * ВНИМАНИЕ: роли «Мастер» и «Инженер ОТ» есть в макете, но не в коде —
 * `Role` это ADMIN | DISPATCHER | OPERATOR | ASSISTANT, а «Механик» это режим
 * администратора. Иконки нарисованы про запас по просьбе владельца и пока
 * никуда не подключены. Появятся роли — подключать сюда.
 */

type IconProps = ComponentPropsWithoutRef<'svg'> & {
  /** Подпись для скринридера. Без неё иконка считается декоративной. */
  label?: string;
};

function IconBase({ label, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      {children}
    </svg>
  );
}

/**
 * Мастер — каска и плечи. Каска отделена от плеч зазором, иначе на 16px
 * силуэт слипается в пятно.
 */
export function ForemanIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 11.5a6 6 0 0 1 12 0" />
      <path d="M3.5 11.5h17" />
      <path d="M6 20.5v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1" />
    </IconBase>
  );
}

/**
 * Инженер ОТ — щит с каской внутри: охрана труда, а не безопасность данных.
 * От `ShieldAlert` (у нас это «риск») отличается содержимым щита.
 */
export function SafetyEngineerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 21.5s7-3.5 7-9v-6l-7-3-7 3v6c0 5.5 7 9 7 9Z" />
      <path d="M9.6 13.2a2.4 2.4 0 0 1 4.8 0" />
      <path d="M8.4 13.2h7.2" />
    </IconBase>
  );
}
