export type OrionEquipment = {
  name: string;
  category: string;
  summary: string;
  image: string | null;
  imageAlt: string;
  sourceUrl?: string;
};

export type OrionStory = {
  slug: string;
  title: string;
};

export const orionEquipment: OrionEquipment[] = [
  { name: 'PVE 50PR', category: 'Вибропогружение', summary: 'Погружение и извлечение шпунта и свай.', image: '/icons/equipment-photos/pve-50pr.jpg', imageAlt: 'Вибропогружатель PVE 50PR', sourceUrl: 'https://www.pve-equipment.com/' },
  { name: 'Liebherr LRH 100 №1', category: 'Свайные работы', summary: 'Свайные работы и лидерное бурение.', image: '/icons/equipment-photos/liebherr-lrh100.jpg', imageAlt: 'Установка Liebherr LRH 100', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
  { name: 'Liebherr LRH 100 №2', category: 'Свайные работы', summary: 'Свайные работы и лидерное бурение.', image: '/icons/equipment-photos/liebherr-lrh100.jpg', imageAlt: 'Установка Liebherr LRH 100 на строительной площадке', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
  { name: 'КБУРГ-16.02 №1', category: 'Копрово-буровые работы', summary: 'Лидерное бурение и монтаж свай.', image: null, imageAlt: 'Копрово-буровая установка КБУРГ-16.02', sourceUrl: 'https://svaeboi.ru/katalog/polnopovorotnye-koprovo-burilnye-ustanovki/kburg-16/' },
  { name: 'КБУРГ-16.02 №2', category: 'Копрово-буровые работы', summary: 'Лидерное бурение и монтаж свай.', image: null, imageAlt: 'Копрово-буровая установка КБУРГ-16.02', sourceUrl: 'https://svaeboi.ru/katalog/polnopovorotnye-koprovo-burilnye-ustanovki/kburg-16/' },
  { name: 'Kopernik-SD-20', category: 'Сваебойные работы', summary: 'Работа со сваями длиной до 20 метров.', image: null, imageAlt: 'Сваебойная установка Kopernik-SD-20' },
  { name: 'Banut 655', category: 'Свайные работы', summary: 'Универсальная работа с гидромолотом.', image: '/icons/equipment-photos/banut-655.jpg', imageAlt: 'Сваебойная установка Banut 655' },
  { name: 'Bauer RTG RM20', category: 'Буровые работы', summary: 'Бурение и устройство оснований.', image: '/icons/equipment-photos/rtg-rm20.jpg', imageAlt: 'Буровая установка Bauer RTG RM20', sourceUrl: 'https://geomek.se/en/foundations/machines/bauer-rtg/' },
];

export const orionStories: OrionStory[] = [];

export const orionCapabilities = [
  ['01', 'Свайные работы', 'Подбираем технологию и технику под геологию, ППР и производственный график объекта.'],
  ['02', 'Лидерное бурение', 'Обеспечиваем точную подготовку основания в условиях сложных грунтов и плотной застройки.'],
  ['03', 'Шпунтовые работы', 'Погружаем и извлекаем шпунт с контролем технологической последовательности.'],
  ['04', 'Аренда с экипажем', 'Предоставляем установку, оператора и сопровождение для управляемого старта работ.'],
] as const;
