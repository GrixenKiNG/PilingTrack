/**
 * Чек-листы двух экранов, которых нет в базе: площадка с ТБ и функциональная
 * проверка после пуска.
 *
 * ПОЧЕМУ ЗАШИТО В КОД, А НЕ В ШАБЛОН. Шаблоны осмотра (`InspectionTemplate`)
 * описывают СОСТОЯНИЕ МАШИНЫ и ведутся механиком под каждую модель. Площадка —
 * не машина: она одна и та же для любой установки, и заводить под неё шаблон
 * значит копировать один список во все модели. Функциональная проверка тоже
 * общая: «ход вперёд-назад», «поворот платформы» есть у любого копра.
 *
 * До выбора варианта оба списка — предмет разговора с владельцем, а не схема.
 * Ответы живут в памяти вкладки и на экране помечены как несохраняемые.
 *
 * СОСТАВ. Взят из чек-листов ТБ макета (забивка свай и лидерное бурение) и
 * сведён к тому, что оператор действительно смотрит глазами за 1–2 минуты.
 * Резать его дальше нельзя: смысл экрана не в скорости, а в том, чтобы человек
 * посмотрел на зону до подъёма мачты.
 */

export interface CheckItem {
  id: string;
  label: string;
  /** Пояснение под строкой: что именно считать нормой. */
  hint?: string;
}

export interface CheckGroup {
  id: string;
  title: string;
  items: CheckItem[];
}

/** Экран 4 «Площадка и ТБ». */
export const SITE_SAFETY_GROUPS: CheckGroup[] = [
  {
    id: 'ground',
    title: 'Основание и площадка',
    items: [
      { id: 'ground-firm', label: 'Основание уплотнено, установка стоит устойчиво' },
      { id: 'ground-levels', label: 'Котлованы и перепады высот обозначены' },
      { id: 'ground-paths', label: 'Пути движения и эвакуации свободны' },
      { id: 'ground-clear', label: 'Посторонние предметы с площадки убраны' },
    ],
  },
  {
    id: 'zone',
    title: 'Опасные зоны и ограждения',
    items: [
      { id: 'zone-fenced', label: 'Опасная зона ограждена и обозначена' },
      {
        id: 'zone-people',
        label: 'Людей в радиусе действия молота нет',
        hint: 'Нахождение под подвешенным грузом запрещено',
      },
      { id: 'zone-piles', label: 'Места складирования свай организованы безопасно' },
    ],
  },
  {
    id: 'utilities',
    title: 'Коммуникации и связь',
    items: [
      { id: 'util-power', label: 'ЛЭП и воздушные линии вне зоны работ' },
      { id: 'util-underground', label: 'Подземные коммуникации обозначены' },
      { id: 'util-radio', label: 'Радиосвязь проверена, канал установлен' },
    ],
  },
  {
    id: 'weather',
    title: 'Погода и условия',
    items: [
      {
        id: 'weather-wind',
        label: 'Скорость ветра допустима для установки',
        hint: 'Сверьте с карточкой погоды на шаге приёмки',
      },
      { id: 'weather-visibility', label: 'Видимость достаточна для работ' },
      { id: 'weather-light', label: 'Освещение рабочей зоны достаточно' },
    ],
  },
  {
    id: 'ppe',
    title: 'СИЗ и инструктаж',
    items: [
      { id: 'ppe-worn', label: 'СИЗ надеты и исправны', hint: 'Каска, перчатки, спецобувь, жилет' },
      { id: 'ppe-briefed', label: 'Персонал проинструктирован по ТБ' },
      { id: 'ppe-extinguisher', label: 'Огнетушитель на месте и исправен' },
    ],
  },
];

/** Экран 5 «Запуск и проверка» — функции проверяются БЕЗ нагрузки. */
export const STARTUP_GROUPS: CheckGroup[] = [
  {
    id: 'controls',
    title: 'Органы управления и ход',
    items: [
      { id: 'ctl-travel', label: 'Ход вперёд и назад' },
      { id: 'ctl-swing', label: 'Поворот платформы влево и вправо' },
      { id: 'ctl-mast', label: 'Подъём и опускание мачты' },
      { id: 'ctl-winch', label: 'Главная и вспомогательная лебёдки' },
      { id: 'ctl-gears', label: 'Редукторы хода и поворота' },
    ],
  },
  {
    id: 'signals',
    title: 'Приборы и сигнализация',
    items: [
      { id: 'sig-lights', label: 'Световые приборы' },
      { id: 'sig-sound', label: 'Звуковая сигнализация и оповещение' },
      { id: 'sig-brakes', label: 'Тормоза' },
    ],
  },
];

/** Подтверждения безопасности перед поворотом ключа — до чек-листа функций. */
export const ENGINE_START_CONFIRMATIONS: CheckItem[] = [
  { id: 'start-people', label: 'Людей в опасной зоне нет' },
  { id: 'start-guards', label: 'Ограждения и системы защиты исправны' },
  { id: 'start-area', label: 'Рабочая зона чистая, препятствий нет' },
];

export const countItems = (groups: readonly CheckGroup[]): number =>
  groups.reduce((sum, group) => sum + group.items.length, 0);

export const groupDone = (group: CheckGroup, checked: Record<string, boolean>): boolean =>
  group.items.every((item) => checked[item.id]);

export const allDone = (groups: readonly CheckGroup[], checked: Record<string, boolean>): boolean =>
  groups.every((group) => groupDone(group, checked));
