/**
 * Карты смазки установок — точки на схеме машины + что/чем/как часто смазывать.
 *
 * Статические данные (как и расходники): справочник «только чтение», авторится
 * в коде, не раздувает приложение, версионируется. Источник — таблицы смазки
 * руководств (Woltman 050FR гл. 6; и т.д.). Координаты точек (x,y) — в системе
 * viewBox 0 0 200 240 силуэта установки (см. компонент LubricationMap).
 *
 * Готовой машинной схемы точек смазки в руководствах нет (только таблицы и
 * взрыв-схемы запчастей), поэтому рисуем чистый векторный силуэт и расставляем
 * пронумерованные точки по зонам — нагляднее и чётче на планшете/телефоне.
 */

export interface LubePoint {
  /** Номер точки на схеме. */
  n: number;
  /** Координаты на силуэте (viewBox 0 0 200 240). */
  x: number;
  y: number;
  /** Название зоны/узла. */
  label: string;
  /** Смазочный материал / спецификация. */
  lubricant: string;
  /** Способ нанесения. */
  method: string;
  /** Периодичность. */
  interval: string;
}

export interface LubeMap {
  /** Подпись схемы (тип силуэта). */
  silhouette: 'crawler-rig';
  points: LubePoint[];
}

const MAPS: Record<string, LubeMap> = {
  // Woltman-PVE 50PR — таблица смазки руководства 050FR (пункты 1–38, сгруппированы по зонам)
  'PVE 50PR': {
    silhouette: 'crawler-rig',
    points: [
      { n: 1, x: 100, y: 188, label: 'Поворотный круг машины', lubricant: 'EP grease grade 2 (дорожка, 8 т.) + gear grease (зубья венца)', method: 'шприц / аэрозоль', interval: '100 ч' },
      { n: 2, x: 104, y: 150, label: 'Поворотный круг мачты', lubricant: 'EP grease grade 2 (4 точки)', method: 'шприц', interval: '100 ч' },
      { n: 3, x: 70, y: 168, label: 'Лебёдки (свайная/копровая/доп.) — концевые подшипники', lubricant: 'EP grease grade 2', method: 'шприц', interval: 'еженедельно' },
      { n: 4, x: 120, y: 182, label: 'Редуктор поворота — уровень/замена масла', lubricant: 'ISO VG 150 (8 л)', method: 'долив/замена', interval: 'уровень нед., замена 2500 ч' },
      { n: 5, x: 44, y: 214, label: 'Ходовой редуктор + натяжитель гусениц', lubricant: 'ISO VG 150 (9 л) · EP grease grade 2 (натяжитель)', method: 'замена/шприц', interval: 'замена 2500 ч · натяжитель мес.' },
      { n: 6, x: 134, y: 150, label: 'Цилиндры (мачта/опоры/балласт/стол)', lubricant: 'EP grease grade 2', method: 'шприц', interval: 'нед./мес.' },
      { n: 7, x: 106, y: 70, label: 'Направляющие мачты и проводники', lubricant: 'EP grease grade 2', method: 'шприц/щётка', interval: 'еженедельно' },
      { n: 8, x: 74, y: 112, label: 'Шарниры А-рамы, выдвижной стол/раскос', lubricant: 'EP grease grade 2', method: 'шприц', interval: 'еженедельно' },
      { n: 9, x: 106, y: 32, label: 'Тросы и шкивы', lubricant: 'EP grease grade 2', method: 'шприц/щётка', interval: 'ежемесячно' },
      { n: 10, x: 130, y: 172, label: 'Гидробак и возвратные фильтры', lubricant: 'ISO VG 46 (масло) · фильтры по каталогу', method: 'проверка/замена', interval: 'фильтры 1000 ч (первая 50 ч)' },
      { n: 11, x: 58, y: 158, label: 'Петли двери кабины', lubricant: 'EP grease grade 2', method: 'шприц', interval: '400 ч' },
    ],
  },

  // КБУРГ-16 — Табл.5 (смазка) и Табл.6 (заправка) руководства. Смазки см. Табл.12.4.
  'КБУРГ-16': {
    silhouette: 'crawler-rig',
    points: [
      { n: 1, x: 78, y: 120, label: 'Оси шарниров рабочего оборудования (тяга/стрела/адаптер)', lubricant: 'Литол-24 ГОСТ 21150', method: 'шприцевание до свежей смазки', interval: 'ЕТО, 8–10 ч' },
      { n: 2, x: 104, y: 104, label: 'Шарнир поворотный (адаптер — мачта)', lubricant: 'Литол-24', method: 'шприцевание до свежей смазки', interval: 'ЕТО, 8–10 ч' },
      { n: 3, x: 106, y: 58, label: 'Оси секций мачты (нижняя/средняя/верхняя, оголовок)', lubricant: 'Литол-24', method: 'шприцевание до свежей смазки', interval: 'ТО-1, ~60 ч' },
      { n: 4, x: 106, y: 30, label: 'Подшипники канатных блоков', lubricant: 'Литол-24', method: 'заполнение вручную', interval: '500 ч' },
      { n: 5, x: 116, y: 86, label: 'Направляющие мачты в зоне движения молота', lubricant: 'Литол-24', method: 'лопаткой по площади', interval: '60 ч' },
      { n: 6, x: 94, y: 42, label: 'Тяговые канаты', lubricant: 'Торсиол 55 ГОСТ 20458', method: 'лопаткой по поверхности', interval: 'по канатной карте' },
      { n: 7, x: 134, y: 150, label: 'Подшипники гидроцилиндров стрелы и раскосов', lubricant: 'Литол-24', method: 'шприцевание (маслёнки в проушинах/осях)', interval: 'ТО' },
      { n: 8, x: 100, y: 188, label: 'Опора поворотная: ролики (4 маслёнки) + зубчатый венец', lubricant: 'Пресс-солидол С / Литол-24', method: 'шприц 5–6 нагнетаний · венец лопаткой во впадины', interval: '200 ч' },
      { n: 9, x: 122, y: 200, label: 'Редукторы механизмов поворота и передвижения', lubricant: 'SHELL Transaxle 75W-90 / ТАП-15В (≈36 л)', method: 'долив/замена', interval: 'долив 250 ч · замена при СТО' },
      { n: 10, x: 44, y: 214, label: 'Механизм натяжения гусениц, направляющие', lubricant: 'Пресс-солидол С ГОСТ 4366-76', method: 'шприц', interval: 'по руководству' },
      { n: 11, x: 28, y: 210, label: 'Натяжные колёса', lubricant: 'ТСп-10 / ТАП-15В', method: 'долив', interval: 'по уровню' },
    ],
  },

  // Jintai SD-20 — «Схема точек смазки» руководства (50/100/250/1000 ч).
  // Смазка консистентная GB7324-94 L-XBCHA3 (литиевая); редукторы — SHELL Omala 220.
  'SD-20': {
    silhouette: 'crawler-rig',
    points: [
      { n: 1, x: 134, y: 150, label: 'Шарниры гидроцилиндров базовой машины', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц (пресс-маслёнки)', interval: '50 ч / еженедельно' },
      { n: 2, x: 106, y: 84, label: 'Шарниры свайных захватов', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц', interval: '50 ч' },
      { n: 3, x: 74, y: 160, label: 'Стабилизаторы (аутригеры)', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц', interval: '50 ч' },
      { n: 4, x: 74, y: 112, label: 'Шарниры механизма подъёма стрелы', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц', interval: '50 ч' },
      { n: 5, x: 104, y: 150, label: 'Подшипники венца ОПУ (маслёнки спереди у кабины)', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц', interval: '50 ч; подшипник +250 ч' },
      { n: 6, x: 100, y: 188, label: 'Венец шестерни опорно-поворотного круга', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'нанесение на зубья', interval: '50 ч' },
      { n: 7, x: 106, y: 32, label: 'Тросы (проверка и смазка)', lubricant: 'Литиевая / канатная смазка', method: 'лопаткой/щёткой', interval: '50 ч' },
      { n: 8, x: 106, y: 55, label: 'Блоки полиспастов', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц (пресс-маслёнки)', interval: '50 ч' },
      { n: 9, x: 44, y: 214, label: 'Направляющие ползуны гусениц', lubricant: 'Литиевая GB7324 L-XBCHA3', method: 'шприц', interval: '50 ч' },
      { n: 10, x: 28, y: 210, label: 'Приводы гусениц (уровень масла)', lubricant: 'SHELL Omala 220 (по R305LC-7)', method: 'проверка/замена', interval: 'проверка 100 ч · замена 1000 ч' },
      { n: 11, x: 120, y: 182, label: 'Привод поворота (уровень масла)', lubricant: 'SHELL Omala 220', method: 'проверка/замена', interval: 'проверка 100 ч · замена 1000 ч' },
      { n: 12, x: 70, y: 168, label: 'Редуктор дополнительной лебёдки (4,5 л)', lubricant: 'SHELL Omala 220', method: 'уровень/замена', interval: 'по руководству' },
    ],
  },

  // Liebherr LRH 100 — смазки из карты смазки руководства (Universalfett 9900 KP 2 K-30,
  // Teleskopfett 9613 Plus, Syntogear Plus 75W-90). Точки — стандартные зоны мачтовой
  // установки; где интервал в руководстве не извлекается однозначно — «по руководству».
  'LRH 100': {
    silhouette: 'crawler-rig',
    points: [
      { n: 1, x: 100, y: 188, label: 'Опорно-поворотный круг (дорожка качения)', lubricant: 'Liebherr Universalfett 9900 (KP 2 K-30)', method: 'шприц', interval: 'по руководству' },
      { n: 2, x: 104, y: 170, label: 'Зубчатый венец механизма поворота', lubricant: 'Liebherr Universalfett 9900', method: 'нанесение на зубья', interval: 'по руководству' },
      { n: 3, x: 106, y: 66, label: 'Направляющие/телескоп мачты (лидера)', lubricant: 'Liebherr Teleskopfett 9613 Plus', method: 'щёткой/шприцем', interval: 'по руководству' },
      { n: 4, x: 74, y: 112, label: 'Шарниры A-рамы и стрелы', lubricant: 'Liebherr Universalfett 9900', method: 'шприц', interval: 'по руководству' },
      { n: 5, x: 134, y: 150, label: 'Гидроцилиндры (мачта, опоры)', lubricant: 'Liebherr Universalfett 9900', method: 'шприц', interval: 'по руководству' },
      { n: 6, x: 106, y: 32, label: 'Канатные блоки и тросы', lubricant: 'Liebherr Universalfett 9900', method: 'шприц/щётка', interval: 'по руководству' },
      { n: 7, x: 120, y: 182, label: 'Редукторы поворота и лебёдок', lubricant: 'Liebherr Syntogear Plus 75W-90', method: 'уровень/замена', interval: 'первая 100 ч · замена ~1000 ч' },
      { n: 8, x: 44, y: 214, label: 'Ходовые редукторы', lubricant: 'Liebherr Syntogear Plus 75W-90', method: 'уровень/замена', interval: 'первая 100 ч · замена ~1000 ч' },
      { n: 9, x: 70, y: 168, label: 'Лебёдки (подшипники, оси)', lubricant: 'Liebherr Universalfett 9900', method: 'шприц', interval: 'по руководству' },
    ],
  },
};

export function getLubeMap(model: string | null | undefined): LubeMap | null {
  if (!model) return null;
  return MAPS[model] ?? null;
}
