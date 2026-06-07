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
};

export function getLubeMap(model: string | null | undefined): LubeMap | null {
  if (!model) return null;
  return MAPS[model] ?? null;
}
