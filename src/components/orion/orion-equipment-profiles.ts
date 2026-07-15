export type OrionEquipmentProfileKey =
  | 'pve-50pr'
  | 'liebherr-lrh100'
  | 'kburg-16'
  | 'kopernik-sd20c'
  | 'banut-655'
  | 'bauer-rtg-rm20';

export type OrionSpecification = {
  label: string;
  value: string;
  featured?: boolean;
};

export type OrionEquipmentProfile = {
  model: string;
  description: string;
  specifications: readonly OrionSpecification[];
  features: readonly string[];
  source: { label: string; url: string };
  pdfPath: string;
  preparedAt: '15.07.2026';
  disclaimer: typeof ORION_PROFILE_DISCLAIMER;
};

export const ORION_PROFILE_DISCLAIMER =
  'Справочные характеристики модели. Фактическая комплектация конкретной установки уточняется по паспорту машины.';

export const orionEquipmentProfiles: Record<OrionEquipmentProfileKey, OrionEquipmentProfile> = {
  'pve-50pr': {
    model: 'PVE 50PR',
    description: 'Справочный профиль PVE 50PR объединяет ключевые габаритные, силовые и эксплуатационные характеристики модели для предварительного знакомства с установкой.',
    specifications: [
      { label: 'Длина лидера', value: '24,8 / 27,8 м', featured: true },
      { label: 'Масса сваи и молота', value: '18,5 т' },
      { label: 'Мощность двигателя', value: '250 л. с.' },
      { label: 'Эксплуатационная масса', value: '51 т' },
      { label: 'Транспортная ширина', value: '3,45 м' },
    ],
    features: ['Лидер длиной 24,8 или 27,8 м', 'Суммарная масса сваи и молота до 18,5 т', 'Эксплуатационная масса 51 т'],
    source: { label: 'Mascus — PVE 50 PR', url: 'https://www.mascus.fr/construction/piling-rigs/pve-50-pr/en8q8rgq.html' },
    pdfPath: '/orion/specs/pve-50pr.pdf',
    preparedAt: '15.07.2026',
    disclaimer: ORION_PROFILE_DISCLAIMER,
  },
  'liebherr-lrh100': {
    model: 'Liebherr LRH 100',
    description: 'Справочный профиль Liebherr LRH 100 собирает основные параметры свай, рабочего оборудования и транспортной конфигурации модели в одном месте.',
    specifications: [
      { label: 'Длина сваи', value: '19,0 м', featured: true },
      { label: 'Эксплуатационная масса', value: '65 т' },
      { label: 'Масса падающей части', value: '2,5–7 т' },
      { label: 'Наклон', value: '±18,4°' },
      { label: 'Транспортировка', value: 'В собранном виде' },
    ],
    features: ['Работа со сваями длиной до 19,0 м', 'Диапазон массы падающей части 2,5–7 т', 'Транспортировка в собранном виде'],
    source: { label: 'Liebherr — LRH 100', url: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
    pdfPath: '/orion/specs/liebherr-lrh100.pdf',
    preparedAt: '15.07.2026',
    disclaimer: ORION_PROFILE_DISCLAIMER,
  },
  'kburg-16': {
    model: 'КБУРГ-16',
    description: 'Справочный профиль КБУРГ-16 фиксирует основные параметры применяемых свай, массу установки и скорость бурения для знакомства с характеристиками модели.',
    specifications: [
      { label: 'Длина сваи', value: '16 м', featured: true },
      { label: 'Сечение сваи', value: '400 × 400 мм' },
      { label: 'Масса сваи', value: '6,5 т' },
      { label: 'Масса установки', value: '49,1 т' },
      { label: 'Скорость бурения', value: '23 об/мин' },
    ],
    features: ['Сваи длиной до 16 м', 'Сечение сваи 400 × 400 мм', 'Скорость бурения 23 об/мин'],
    source: { label: 'Gruzovik.com — КБУРГ-16', url: 'https://www.gruzovik.com/stroitelnaya-tehnika/svaeboynye-ustanovki/bashstroy-kburg-16-a9759783.html' },
    pdfPath: '/orion/specs/kburg-16.pdf',
    preparedAt: '15.07.2026',
    disclaimer: ORION_PROFILE_DISCLAIMER,
  },
  'kopernik-sd20c': {
    model: 'Kopernik SD-20C',
    description: 'Справочный профиль Kopernik SD-20C объединяет сведения о массе, двигателе, бурении, мачте и частоте вращения рабочего оборудования модели.',
    specifications: [
      { label: 'Масса без инструмента', value: '57 т', featured: true },
      { label: 'Мощность двигателя', value: '267 л. с.' },
      { label: 'Диаметр бурения с обсадной трубой', value: '2000 мм' },
      { label: 'Диаметр бурения без обсадной трубы', value: '1500 мм' },
      { label: 'Высота мачты', value: '21,57 м' },
      { label: 'Частота вращения', value: '8–30 об/мин' },
    ],
    features: ['Масса 57 т без инструмента', 'Бурение до 2000 мм с обсадной трубой', 'Частота вращения 8–30 об/мин'],
    source: { label: 'Ehkskavator.ru — Kopernik SD-20C', url: 'https://ehkskavator.ru/item/1038754' },
    pdfPath: '/orion/specs/kopernik-sd20c.pdf',
    preparedAt: '15.07.2026',
    disclaimer: ORION_PROFILE_DISCLAIMER,
  },
  'banut-655': {
    model: 'Banut 655',
    description: 'Справочный профиль Banut 655 сводит параметры сваи, лидера, двигателя, массы и доступных наклонов мачты для знакомства с возможностями модели.',
    specifications: [
      { label: 'Длина сваи', value: '20 м', featured: true },
      { label: 'Полезная длина лидера', value: '15 м' },
      { label: 'Масса', value: 'Около 70 т' },
      { label: 'Мощность двигателя', value: '261 кВт' },
      { label: 'Масса сваи', value: '8,5–12 т' },
      { label: 'Наклоны мачты', value: '18° / 45° и 18°' },
    ],
    features: ['Сваи длиной до 20 м', 'Полезная длина лидера 15 м', 'Диапазон массы сваи 8,5–12 т'],
    source: { label: 'Fymas Auctions — Banut 655', url: 'https://www.fymasauctions.dk/us/Listing/Details/24097910' },
    pdfPath: '/orion/specs/banut-655.pdf',
    preparedAt: '15.07.2026',
    disclaimer: ORION_PROFILE_DISCLAIMER,
  },
  'bauer-rtg-rm20': {
    model: 'Bauer RTG RM20',
    description: 'Справочный профиль Bauer RTG RM20 объединяет параметры сваи, падающей части, двигателя, высоты и массы установки в конфигурации с HRS 5.',
    specifications: [
      { label: 'Длина сваи', value: '20 м', featured: true },
      { label: 'Масса падающей части', value: '10 т' },
      { label: 'Мощность двигателя', value: '201 кВт' },
      { label: 'Высота', value: '25,7 м' },
      { label: 'Масса с HRS 5', value: 'Около 68,6 т' },
    ],
    features: ['Сваи длиной до 20 м', 'Масса падающей части 10 т', 'Масса около 68,6 т с HRS 5'],
    source: { label: 'RTG Rammtechnik — RM 20', url: 'https://www.rtg-rammtechnik.de/de/rm-20' },
    pdfPath: '/orion/specs/bauer-rtg-rm20.pdf',
    preparedAt: '15.07.2026',
    disclaimer: ORION_PROFILE_DISCLAIMER,
  },
};