import type { OrionEquipmentProfileKey } from './orion-equipment-profiles';

export type OrionEquipmentPhoto = {
  src: string;
  alt: string;
  credit: string;
  sourceUrl: string;
};

export type OrionEquipment = {
  name: string;
  profileKey: OrionEquipmentProfileKey;
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
  { name: 'PVE 50PR', profileKey: 'pve-50pr', category: 'Вибропогружение', summary: 'Погружение и извлечение шпунта и свай.', photoSlots: 5, photos: pvePhotos },
  { name: 'Liebherr LRH 100 №1', profileKey: 'liebherr-lrh100', category: 'Свайные работы', summary: 'Свайные работы и лидерное бурение.', photoSlots: 5, photos: liebherrPhotos },
  { name: 'Liebherr LRH 100 №2', profileKey: 'liebherr-lrh100', category: 'Свайные работы', summary: 'Свайные работы и лидерное бурение.', photoSlots: 5, photos: liebherrPhotos },
  { name: 'КБУРГ-16.02 №1', profileKey: 'kburg-16', category: 'Копрово-буровые работы', summary: 'Лидерное бурение и монтаж свай.', photoSlots: 5, photos: kburgPhotos },
  { name: 'КБУРГ-16.02 №2', profileKey: 'kburg-16', category: 'Копрово-буровые работы', summary: 'Лидерное бурение и монтаж свай.', photoSlots: 5, photos: kburgPhotos },
  { name: 'Kopernik-SD-20', profileKey: 'kopernik-sd20c', category: 'Сваебойные работы', summary: 'Работа со сваями длиной до 20 метров.', photoSlots: 5, photos: kopernikPhotos },
  { name: 'Banut 655', profileKey: 'banut-655', category: 'Свайные работы', summary: 'Универсальная работа с гидромолотом.', photoSlots: 5, photos: banutPhotos },
  { name: 'Bauer RTG RM20', profileKey: 'bauer-rtg-rm20', category: 'Буровые работы', summary: 'Бурение и устройство оснований.', photoSlots: 5, photos: bauerPhotos },
];

export const orionStories: OrionStory[] = [];

export type OrionProofPoint = {
  value: string;
  label: string;
};

export type OrionProcessStep = {
  number: string;
  title: string;
  copy: string;
};

export const orionProofPoints = [
  { value: '8', label: 'единиц собственного парка' },
  { value: 'ППР', label: 'работа по проекту' },
  { value: 'Экипаж', label: 'аренда с оператором' },
] as const satisfies readonly OrionProofPoint[];

export const orionProcessSteps = [
  { number: '01', title: 'Исходные данные', copy: 'Изучаем проект, геологию, условия площадки и производственный график.' },
  { number: '02', title: 'Технология и ППР', copy: 'Согласовываем способ производства работ, состав техники и последовательность.' },
  { number: '03', title: 'Мобилизация', copy: 'Готовим установку, экипаж и зоны ответственности к выходу на объект.' },
  { number: '04', title: 'Производство', copy: 'Ведём работы по согласованной технологии и производственному контролю.' },
  { number: '05', title: 'Документация', copy: 'Фиксируем выполненные этапы и передаём предусмотренную исполнительную документацию.' },
] as const satisfies readonly OrionProcessStep[];

export const orionCapabilities = [
  ['01', 'Свайные работы', 'Статическое вдавливание и забивка свай любой длины. Бесшумно и без вибраций — можно работать рядом с существующими зданиями.'],
  ['02', 'Лидерное бурение', 'Обеспечиваем точную подготовку основания в условиях сложных грунтов и плотной застройки.'],
  ['03', 'Шпунтовые работы', 'Погружаем и извлекаем шпунт с контролем технологической последовательности.'],
  ['04', 'Аренда с экипажем', 'Предоставляем установку, оператора и сопровождение для управляемого старта работ.'],
] as const;

export type OrionCompanyFact = { value: string; label: string };

export const orionCompanyFacts = [
  { value: 'с 2006', label: 'года на рынке' },
  { value: '20 лет', label: 'опыта в фундаментостроении' },
  { value: 'вся Россия', label: 'база в Чувашии, работаем по стране' },
] as const satisfies readonly OrionCompanyFact[];

export const orionCompanyIntro =
  'ООО «ОРИОН» — строительная компания полного цикла. С 2006 года выполняем свайные работы любой сложности на объектах гражданского и промышленного строительства. Базируемся в Чувашской Республике и работаем по всей России. Собственный парк современной техники позволяет работать бесшумно и точно рядом с жилыми зданиями.';

export type OrionObject = { title: string; kind: string; image?: string };

export const orionObjects: OrionObject[] = [
  { title: 'Верховный Суд Чувашской Республики', kind: 'Гражданское строительство' },
  { title: 'Дом Правительства', kind: 'Гражданское строительство' },
  { title: 'ТРК «Мадагаскар»', kind: 'Торгово-развлекательный комплекс' },
  { title: 'Мега Молл', kind: 'Торгово-развлекательный комплекс' },
  { title: 'Федеральный медицинский центр ортопедии и травматологии', kind: 'Промышленно-медицинский объект' },
  { title: 'Театр оперы и балета', kind: 'Реконструкция' },
];

export type OrionControlPoint = { title: string; copy: string };

export const orionDigitalControlIntro =
  'ОРИОН ведёт свайные работы в собственной цифровой системе PilingTrack. Каждая смена, каждая свая и состояние техники фиксируются онлайн — заказчик получает прозрачную и проверяемую картину хода работ.';

export const orionDigitalControl: OrionControlPoint[] = [
  { title: 'Онлайн-мониторинг парка', copy: 'Состояние каждой установки, объект и оператор — в реальном времени.' },
  { title: 'Сменные отчёты с фотофиксацией', copy: 'Объёмы, сваи и простои фиксируются по каждой смене с фотографиями.' },
  { title: 'Контроль ТО и готовности', copy: 'График техобслуживания и моточасы — техника не встаёт неожиданно.' },
  { title: 'Прозрачная документация', copy: 'Исполнительные данные по объекту собираются автоматически и проверяемы.' },
];

export const orionClients: string[] = [
  'ОАО «Чувашавтодор»',
  'ОАО «Акконд»',
  'ООО «Монолитное строительство»',
  'ООО «Стройтрест 4»',
  'ЗАО «ТУС»',
  'ГУП «РУКС»',
];

export type OrionGeneralUnit = { name: string; role: string };

export const orionGeneralEquipment: OrionGeneralUnit[] = [
  { name: 'СВУ-В6', role: 'Сваевдавливающая установка' },
  { name: 'Экскаваторы Volvo', role: 'Земляные работы' },
  { name: 'Бульдозеры Четра Т20, Т25', role: 'Планировка и земляные работы' },
];

export type OrionRequisites = {
  legalName: string;
  inn: string;
  kpp: string;
  address: string;
  phones: string[];
  email: string;
};

export const orionRequisites: OrionRequisites = {
  legalName: 'ООО «ОРИОН»',
  inn: '2130007836',
  kpp: '213001001',
  address: '428003, Чувашская Республика, г. Чебоксары, Школьный проезд, д. 1, оф. 412',
  phones: ['(8352) 56-40-66', '(8352) 56-42-80', '+7 961 346-45-14'],
  email: 'orion02@bk.ru',
};
