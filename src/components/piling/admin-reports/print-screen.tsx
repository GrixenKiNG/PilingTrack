'use client';

/**
 * Стили печати рабочих экранов (R134, находка 1).
 *
 * ЧТО БЫЛО НЕ ТАК. `window.print()` на экране отчётов и на карточке наряда ТО
 * печатал страницу целиком: на лист попадали шапка и меню администраторской
 * оболочки, а таблица обрезалась по краю области прокрутки — правые графы
 * пропадали.
 *
 * ЧТО ДЕЛАЮТ ПРАВИЛА. При печати на листе остаётся только область с классом
 * `print-area`: оболочка скрыта, а область печати и её предки перестают
 * обрезать содержимое. Правило включается, только если `print-area` на
 * странице есть, — экраны без него печатаются как прежде.
 *
 * ПОЧЕМУ СТРОКОЙ, А НЕ .css-ФАЙЛОМ. Импорт CSS из компонента роняет прогон
 * vitest этого проекта (PostCSS-плагин Tailwind не поднимается в тестовом
 * окружении), а у раздела отчётов нет своего маршрута печати, где CSS можно
 * было бы подключить, как у журнала инструктажей
 * (`src/app/print/briefing-journal/print.css`). Поэтому правила живут строкой
 * рядом с экраном.
 */
const PRINT_SCREEN_CSS = `
@media print {
  body:has(.print-area) * {
    visibility: hidden;
  }
  body:has(.print-area) .print-area,
  body:has(.print-area) .print-area * {
    visibility: visible;
  }
  body:has(.print-area) :has(.print-area),
  body:has(.print-area) .print-area,
  body:has(.print-area) .print-area * {
    overflow: visible !important;
  }
}
`;

export function PrintScreenStyles() {
  return <style dangerouslySetInnerHTML={{ __html: PRINT_SCREEN_CSS }} />;
}
