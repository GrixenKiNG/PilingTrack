export type OrionEquipmentPhoto = {
  src: string;
  alt: string;
  credit: string;
  sourceUrl: string;
};

export type OrionEquipment = {
  name: string;
  category: string;
  summary: string;
  photoSlots: 5;
  photos: OrionEquipmentPhoto[];
};

const pvePhotos: OrionEquipmentPhoto[] = [
  { src: '/icons/equipment-photos/pve-50pr.jpg', alt: 'Сваебойная установка PVE 50PR на площадке', credit: 'PVE / Dieseko Group', sourceUrl: 'https://www.diesekogroup.com/our-brands/woltman/' },
  { src: '/orion/equipment/pve-50pr/02.jpg', alt: 'PVE 50PR в рабочей конфигурации', credit: 'Dieseko Group', sourceUrl: 'https://www.diesekogroup.com/our-brands/woltman/' },
  { src: '/orion/equipment/pve-50pr/03.jpg', alt: 'PVE 50PR, общий вид', credit: 'Imeco', sourceUrl: 'https://www.imeco.at/used-equipment/piling-rigs-with-impact-hammers/' },
  { src: '/orion/equipment/pve-50pr/04.jpg', alt: 'PVE 50PR, вид со стороны мачты', credit: 'Imeco', sourceUrl: 'https://www.imeco.at/used-equipment/piling-rigs-with-impact-hammers/' },
  { src: 'https://i.ytimg.com/vi/Th_hQ_1Ty0I/hqdefault.jpg', alt: 'PVE 50PR в демонстрационном видео', credit: 'SMT Sweden / YouTube', sourceUrl: 'https://www.mascus.fr/construction/piling-rigs/pve-50-pr/en8q8rgq.html' },
];

const liebherrPhotos: OrionEquipmentPhoto[] = [
  { src: '/orion/equipment/liebherr-lrh100/01.webp', alt: 'Liebherr LRH 100 с гидромолотом', credit: 'Liebherr', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
  { src: '/orion/equipment/liebherr-lrh100/02.webp', alt: 'Liebherr LRH 100 при погружении свай', credit: 'Liebherr', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
  { src: '/orion/equipment/liebherr-lrh100/03.webp', alt: 'Liebherr LRH 100 на фундаментных работах', credit: 'Liebherr', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
  { src: '/orion/equipment/liebherr-lrh100/04.webp', alt: 'Liebherr LRH 100, рабочее оборудование', credit: 'Liebherr', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
  { src: '/orion/equipment/liebherr-lrh100/05.webp', alt: 'Liebherr LRH 100, модельный ракурс', credit: 'Liebherr', sourceUrl: 'https://www.liebherr.com/en-us/p/lrh100-4424797' },
];

const kburgPhotos: OrionEquipmentPhoto[] = Array.from({ length: 5 }, (_, index) => ({
  src: `/orion/equipment/kburg-16/0${index + 1}.jpg`,
  alt: `Копрово-бурильная установка КБУРГ-16, ракурс ${index + 1}`,
  credit: 'БашСтрой / Gruzovik.com',
  sourceUrl: 'https://www.gruzovik.com/stroitelnaya-tehnika/svaeboynye-ustanovki/bashstroy-kburg-16-a9759783.html',
}));

const kopernikPhotos: OrionEquipmentPhoto[] = Array.from({ length: 5 }, (_, index) => ({
  src: `/orion/equipment/kopernik-sd20/0${index + 1}.jpg`,
  alt: `Сваебойная установка Kopernik SD-20C, ракурс ${index + 1}`,
  credit: 'Ehkskavator.ru',
  sourceUrl: 'https://ehkskavator.ru/item/1038754',
}));

const banutPhotos: OrionEquipmentPhoto[] = Array.from({ length: 5 }, (_, index) => ({
  src: `/orion/equipment/banut-655/0${index + 1}.jpg`,
  alt: `Сваебойная установка Banut 655, ракурс ${index + 1}`,
  credit: 'Fymas Auctions',
  sourceUrl: 'https://www.fymasauctions.dk/us/Listing/Details/24097910',
}));

const bauerPhotos: OrionEquipmentPhoto[] = [
  { src: '/icons/equipment-photos/rtg-rm20.jpg', alt: 'Bauer RTG RM20 на площадке', credit: 'Geomek', sourceUrl: 'https://geomek.se/en/foundations/machines/bauer-rtg/' },
  { src: '/orion/equipment/bauer-rtg-rm20/02.jpg', alt: 'Установка Bauer RTG в работе', credit: 'Geomek', sourceUrl: 'https://geomek.se/en/foundations/machines/bauer-rtg/' },
  { src: '/orion/equipment/bauer-rtg-rm20/03.jpg', alt: 'RTG RM20, рабочий ракурс', credit: 'RTG Rammtechnik', sourceUrl: 'https://www.rtg-rammtechnik.de/de/rm-20' },
  { src: '/orion/equipment/bauer-rtg-rm20/04.jpg', alt: 'RTG RM20, вид со стороны рабочего оборудования', credit: 'Equipment Corporation of America', sourceUrl: 'https://www.ecanet.com/equipment/for-sale/rtg-rm20' },
  { src: '/orion/equipment/bauer-rtg-rm20/05.jpg', alt: 'RTG RM20, вид сзади', credit: 'Equipment Corporation of America', sourceUrl: 'https://www.ecanet.com/equipment/for-sale/rtg-rm20' },
];

export type OrionStory = {
  slug: string;
  title: string;
};

export const orionEquipment: OrionEquipment[] = [
  { name: 'PVE 50PR', category: 'Вибропогружение', summary: 'Погружение и извлечение шпунта и свай.', photoSlots: 5, photos: pvePhotos },
  { name: 'Liebherr LRH 100 №1', category: 'Свайные работы', summary: 'Свайные работы и лидерное бурение.', photoSlots: 5, photos: liebherrPhotos },
  { name: 'Liebherr LRH 100 №2', category: 'Свайные работы', summary: 'Свайные работы и лидерное бурение.', photoSlots: 5, photos: liebherrPhotos },
  { name: 'КБУРГ-16.02 №1', category: 'Копрово-буровые работы', summary: 'Лидерное бурение и монтаж свай.', photoSlots: 5, photos: kburgPhotos },
  { name: 'КБУРГ-16.02 №2', category: 'Копрово-буровые работы', summary: 'Лидерное бурение и монтаж свай.', photoSlots: 5, photos: kburgPhotos },
  { name: 'Kopernik-SD-20', category: 'Сваебойные работы', summary: 'Работа со сваями длиной до 20 метров.', photoSlots: 5, photos: kopernikPhotos },
  { name: 'Banut 655', category: 'Свайные работы', summary: 'Универсальная работа с гидромолотом.', photoSlots: 5, photos: banutPhotos },
  { name: 'Bauer RTG RM20', category: 'Буровые работы', summary: 'Бурение и устройство оснований.', photoSlots: 5, photos: bauerPhotos },
];

export const orionStories: OrionStory[] = [];

export const orionCapabilities = [
  ['01', 'Свайные работы', 'Подбираем технологию и технику под геологию, ППР и производственный график объекта.'],
  ['02', 'Лидерное бурение', 'Обеспечиваем точную подготовку основания в условиях сложных грунтов и плотной застройки.'],
  ['03', 'Шпунтовые работы', 'Погружаем и извлекаем шпунт с контролем технологической последовательности.'],
  ['04', 'Аренда с экипажем', 'Предоставляем установку, оператора и сопровождение для управляемого старта работ.'],
] as const;
