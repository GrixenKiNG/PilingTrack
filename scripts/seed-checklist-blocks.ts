/**
 * Seed checklist blocks (ЕО) from the accumulated canon in
 * docs/superpowers/specs/2026-06-03-maintenance-redesign-notes.md.
 *
 * Idempotent: skips a block if a template with the same name already exists.
 * Deactivates the old mislabeled "ЕО гидромолота" (BASE/HHK7A) seed.
 *
 * Run (local dev):  npx tsx scripts/seed-checklist-blocks.ts
 *
 * Content provenance is real (user-provided manuals). Where a manual gives a
 * norm it is included; where it does not, the norm is left blank to fill in.
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/postgres-client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL_POSTGRES (or DATABASE_URL) required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type Ans = 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';
type Block = 'BASE' | 'HAMMER' | 'ROTARY';
type Level = 'EO' | 'TO1' | 'TO2' | 'TO3' | 'SEASONAL';
type Hammer = 'HYDRAULIC' | 'DIESEL' | 'NONE';

interface Item { text: string; answerType?: Ans; unit?: string; norm?: string; provenance?: string; photoRequired?: boolean }
interface Section { title: string; items: Item[] }
interface BlockDef {
  name: string; blockType: Block; level: Level;
  appliesToModel?: string | null; appliesToHammerKind?: Hammer | null;
  sections: Section[];
}

const D = (text: string): Item => ({ text, answerType: 'DONE' });

const BLOCKS: BlockDef[] = [
  // ─────────────── HAMMER · HYDRAULIC (PVE 7NL / Junttan HHK) §12d-FINAL/CANON
  {
    name: 'ЕО — гидромолот (PVE 7NL / Junttan HHK)',
    blockType: 'HAMMER', level: 'EO', appliesToHammerKind: 'HYDRAULIC',
    sections: [
      { title: 'Внешний осмотр', items: [
        { text: 'Трещины корпуса', answerType: 'STATUS4', photoRequired: true },
        { text: 'Деформации корпуса / направляющих', answerType: 'STATUS4' },
        { text: 'Сварные швы без трещин' },
        { text: 'Нет течей гидромасла' },
        { text: 'Крепёжные болты и гайки затянуты' },
        { text: 'Проушины и точки подъёма в норме' },
        { text: 'Защитные кожухи на месте' },
        { text: 'Знаки безопасности разборчивы' },
      ] },
      { title: 'Гидросистема', items: [
        { text: 'Гидрошланги без повреждений' },
        { text: 'Нет подтёков на фитингах' },
        { text: 'Крепление шлангов надёжно' },
        { text: 'Рабочее давление молота', answerType: 'MEASURE', unit: 'бар', norm: 'PVE 7NL / HHK7A ~183, HHK5A ~131', provenance: 'PVE/Junttan руководство' },
        { text: 'Нет вибрации напорной линии' },
        { text: 'Нет вибрации сливной линии' },
      ] },
      { title: 'Гидроаккумуляторы', items: [
        { text: 'Корпус без повреждений' },
        { text: 'Нет утечек азота' },
        { text: 'Крепления надёжны' },
        { text: 'Давление зарядки (азот, HP)', answerType: 'MEASURE', unit: 'бар', norm: 'HHK7A 91 / HHK5A 65 / PVE 30–150; линия слива (LP) 6' },
      ] },
      { title: 'Ударная часть (бегунок)', items: [
        { text: 'Шток чистый (очищен от грязи/льда)' },
        { text: 'Нет задиров на штоке' },
        { text: 'Направляющие бегунка в норме' },
        { text: 'Нет повреждений ударной части', answerType: 'STATUS4' },
        { text: 'Демпферы подъёма / уретановые амортизаторы целы' },
        { text: 'Нет посторонних шумов при ходе бегунка' },
      ] },
      { title: 'Свайный наголовник', items: [
        { text: 'Нет трещин', answerType: 'STATUS4', photoRequired: true },
        { text: 'Демпферная подушка', answerType: 'MEASURE', unit: 'мм', norm: 'Ø600: новая 200, замена при ≤150; PVE — при <20%' },
        { text: 'Демпферное кольцо целое' },
        { text: 'Фиксирующий фланец в норме' },
        { text: 'Затяжка крепежа' },
      ] },
      { title: 'Смазка', items: [
        D('Направляющие корпуса'), D('Направляющие ударной части'),
        D('Свайный наголовник'), D('Пальцы соединений'), D('Подвижные элементы молота'),
      ] },
      { title: 'Электрооборудование', items: [
        { text: 'Датчики положения' },
        { text: 'Разъёмы и кабели' },
        { text: 'Соленоидный клапан' },
        { text: 'Аварийная остановка (S2)' },
        { text: 'Панель управления' },
      ] },
      { title: 'Проверка перед забивкой', items: [
        { text: 'Молот свободно опирается на сваю' },
        { text: 'Тросы лебёдки ослаблены' },
        { text: 'Персонал выведен из опасной зоны' },
        { text: 'Свая установлена по проекту' },
        { text: 'Убран транспортировочный фиксатор ударной части' },
        { text: 'Высота удара минимальна для прогрева' },
      ] },
      { title: 'Контроль в процессе работы', items: [
        { text: 'Нет ударов бегунка в верхний ограничитель' },
        { text: 'Нет чрезмерной вибрации' },
        { text: 'Давление в норме' },
        { text: 'Нет перегрева масла' },
        { text: 'Ход наголовника', answerType: 'MEASURE', unit: 'мм', norm: '80–150' },
      ] },
      { title: 'После окончания смены', items: [
        D('Молот очищен от грунта/бетона'), D('Шток очищен'),
        { text: 'Осмотр на повреждения' },
        D('Зафиксирована наработка'),
        { text: 'Записаны замечания', answerType: 'DONE' },
      ] },
    ],
  },

  // ─────────────── HAMMER · DIESEL (DD / DDT-45) §12c-CANON
  {
    name: 'ЕО — дизель-молот (DD / DDT-45)',
    blockType: 'HAMMER', level: 'EO', appliesToHammerKind: 'DIESEL',
    sections: [
      { title: 'Перед началом работы', items: [
        { text: 'Молот очищен от консервационной смазки' },
        { text: 'Топливный бак заправлен (ДТ)' },
        { text: 'Цилиндр поднят кошкой на 1,5 м и застопорен подставкой', photoRequired: true },
        { text: 'ТНВД прокачан вручную до топлива через форсунку' },
        { text: 'Отверстие форсунки не засорено' },
        { text: 'Полость цилиндра очищена' },
        { text: 'Верёвки к кошке (сброс) и к рычагу подачи топлива привязаны' },
        { text: 'Затяжка и стопорение всех болтов' },
        { text: 'Сварные швы без трещин', answerType: 'STATUS4' },
      ] },
      { title: 'Смазка (карта ЕО)', items: [
        D('Поршневые кольца — масло ДС-8/ДС-11, кистью (после каждой сваи)'),
        D('Направляющие штанги — УС-2 (Литол/Солидол), шприцем (5–10 свай)'),
        D('Толкатель ТНВД — ДС-8/ДС-11, кистью (5–10 свай)'),
        D('Эксцентриковый валик — ДС-8/ДС-11 (5–10 свай)'),
      ] },
      { title: 'Топливо и пробный пуск', items: [
        { text: 'Топливная смесь ДТ:масло 8:2 (7:3 в холод), фильтрованная без воды' },
        { text: 'Зазор кошка–траверса', answerType: 'MEASURE', unit: 'мм', norm: '350–400 (не поднимать до касания)' },
        { text: 'Устойчивость первых ударов при пуске' },
        { text: 'Дымность выхлопа (цвет) в норме' },
        { text: 'Нет посторонних стуков' },
      ] },
      { title: 'Безопасность', items: [
        { text: 'При передвижении копра цилиндр внизу' },
        { text: 'Никто не находится под молотом' },
        { text: 'Молот не обслуживается при поднятом незастопоренном цилиндре' },
        { text: 'СИЗ слуха в наличии' },
        { text: 'Наголовников ≥2 (один в работе, один в запасе)' },
      ] },
    ],
  },

  // ─────────────── BASE · Woltman-PVE 50PR §12e-CANON
  {
    name: 'ЕО — установка Woltman-PVE 50PR',
    blockType: 'BASE', level: 'EO', appliesToModel: 'PVE 50PR',
    sections: [
      { title: 'Внешний осмотр', items: [
        { text: 'Нет трещин/деформаций металлоконструкций (мачта, рама, А-рама)', answerType: 'STATUS4', photoRequired: true },
        { text: 'Коррозия металла', answerType: 'MEASURE', unit: '%', norm: 'не более 10% толщины' },
        { text: 'Сварные швы в норме' },
        { text: 'Нет течей гидромасла' },
        { text: 'Крепёжные болты (мачта/А-рама/опоры) затянуты' },
        { text: 'Проушины / такелажные точки в норме' },
        { text: 'Защитные кожухи и знаки безопасности на месте' },
        { text: 'Огнетушитель и аптечка на месте' },
        { text: 'Ступени/поручни/настил чистые (антискольжение)' },
        { text: 'Нет масляного пятна под машиной (ночная течь)' },
      ] },
      { title: 'Двигатель CAT C7.1 ACERT', items: [
        { text: 'Уровень моторного масла', answerType: 'MEASURE', norm: 'по щупу' },
        { text: 'Уровень охлаждающей жидкости', answerType: 'MEASURE', norm: 'по бачку' },
        { text: 'Нет утечек топлива/масла/ОЖ' },
        { text: 'Индикатор воздушного фильтра' },
        { text: 'Ремни (генератор/вентилятор/кондиционер)' },
        { text: 'Выпуск (дым/шум) в норме' },
        D('Слит отстой/вода из фильтра-сепаратора'),
        { text: 'Уровень топлива', answerType: 'MEASURE' },
      ] },
      { title: 'Гидросистема', items: [
        { text: 'Уровень масла в гидробаке (ISO VG 46)', answerType: 'MEASURE', norm: 'между мин/макс' },
        { text: 'Шланги без повреждений' },
        { text: 'Нет подтёков (фитинги/клапаны/насосы/цилиндры)' },
        { text: 'Индикаторы возвратных фильтров' },
        { text: 'Охладитель чист, вентилятор работает' },
        { text: 'Нет шумов насосов' },
        { text: 'Нет воды в масле' },
        { text: 'Температура масла в норме (индикатор)' },
      ] },
      { title: 'Лебёдки и канаты', items: [
        { text: 'Канаты лебёдок (износ, обрывы — ISO 4309)', answerType: 'STATUS4', photoRequired: true },
        { text: 'Шкивы вращаются свободно' },
        { text: 'Износ шкивов', answerType: 'MEASURE', unit: '%', norm: '≤25%' },
        { text: 'Канатные зажимы (конец каната)', answerType: 'MEASURE', unit: 'мм', norm: '≥50' },
      ] },
      { title: 'Гусеничный ход', items: [
        { text: 'Звенья/пластины без повреждений' },
        { text: 'Ведущие/направляющие колёса в норме' },
        { text: 'Опорные/поддерживающие роллеры (вращение, нет течей)' },
        D('Смазка точек натяжения'),
      ] },
      { title: 'Мачта лидера и направляющие', items: [
        D('Скользящие поверхности смазаны'),
        D('Проводники копра смазаны'),
        { text: 'Накладки проводников не изношены' },
        { text: 'Болты направляющих затянуты' },
        D('Шарнир мачта/выдвижной стол смазан'),
      ] },
      { title: 'Опоры, выдвижной стол, балласт', items: [
        { text: 'Задние опорные цилиндры (нет течей, штоки чистые)' },
        D('Шарниры опор смазаны'),
        D('Выдвижной стол (8 точек смазки)'),
        { text: 'Балласт (цилиндры, нет трения)' },
      ] },
      { title: 'А-образная конструкция и цилиндры', items: [
        D('Бронзовые втулки смазаны'),
        { text: 'Радиальный зазор втулок', answerType: 'MEASURE', unit: 'мм', norm: '≤1,5' },
        { text: 'Фиксирующие пластины/болты в норме' },
        { text: 'Цилиндры (верхний/мачты/стола) без течей' },
        { text: 'Штоки чистые, нет задиров хрома' },
      ] },
      { title: 'Электрооборудование и управление', items: [
        { text: 'Аварийный стоп (S2)' },
        { text: 'Блокировка рычагов (подлокотник)' },
        { text: 'Ограничители лебёдок (головка мачты)' },
        { text: 'Панель копра (питание/дисплей)' },
        { text: 'Предохранители целы' },
        { text: 'Провода/разъёмы (нет окисления)' },
        { text: 'АКБ 2×24V (полюса чистые)' },
        { text: 'Освещение/фары, проблесковый маяк' },
        { text: 'Звуковой сигнал, сигнал заднего хода' },
      ] },
      { title: 'Проверка перед забивкой', items: [
        { text: 'Ровная площадка с достаточной несущей способностью' },
        { text: 'Задние опоры опущены/зафиксированы' },
        { text: 'Свая в наголовнике, параллельна, зафиксирована' },
        { text: 'Персонал выведен (радиус поворота, под мачтой)' },
        { text: 'Ветер', answerType: 'MEASURE', unit: 'м/с', norm: '≤17,1 работа; >20,8 остановить (макс 20)' },
        { text: 'Запас хода наголовника', answerType: 'MEASURE', unit: 'мм', norm: '80–150' },
      ] },
      { title: 'После смены', items: [
        D('Молот в STOP'), D('Грузы сняты'),
        D('Лидер в транспортную позицию/на грунт'),
        D('Двигатель выключен, ключ извлечён, главный выключатель выкл'),
        D('Зафиксирована наработка, записаны замечания'),
      ] },
    ],
  },

  // ─────────────── BASE · Liebherr LRH 100 §16.1
  {
    name: 'ЕО — установка Liebherr LRH 100',
    blockType: 'BASE', level: 'EO', appliesToModel: 'LRH 100',
    sections: [
      { title: 'Перед пуском', items: [
        { text: 'Уровень моторного масла (смотровое стекло)', answerType: 'MEASURE' },
        { text: 'Уровень ОЖ', answerType: 'MEASURE' },
        { text: 'Уровень гидромасла (смотровое стекло)', answerType: 'MEASURE' },
        { text: 'Уровень топлива', answerType: 'MEASURE' },
        { text: 'Нет течей' },
        { text: 'Главный выключатель АКБ включён' },
        { text: 'Запорный элемент гидробака открыт' },
      ] },
      { title: 'Осмотр машины', items: [
        { text: 'Трещины/швы металлоконструкций', answerType: 'STATUS4', photoRequired: true },
        { text: 'Стёкла/зеркала чистые' },
        { text: 'Очищено от снега/льда' },
        { text: 'Таблички на месте' },
        { text: 'Огнетушители (пломба/срок)' },
        { text: 'Аптечка (ÖNORM V 5101), аварийный молоток' },
      ] },
      { title: 'Гидросистема и двигатель (CAT C7.1 / Liebherr D936)', items: [
        { text: 'Шланги без повреждений, нет подтёков' },
        { text: 'Индикаторы возвратных фильтров' },
        { text: 'Температура масла на экране в норме', answerType: 'MEASURE' },
        { text: 'Давление масла двигателя' },
        { text: 'Индикатор воздушного фильтра' },
        { text: 'Ремни, посторонние шумы' },
      ] },
      { title: 'Лебёдки и канаты', items: [
        { text: 'Визуальный осмотр канатов', answerType: 'STATUS4', photoRequired: true },
        { text: 'Шкивы в норме' },
        { text: 'Концевики подъёма' },
      ] },
      { title: 'Ходовая часть', items: [
        { text: 'Натяжение цепей (мерной рейкой)', answerType: 'MEASURE', unit: 'мм', norm: 'зазор ≤40; давление натяжного цилиндра 160–180 бар' },
        { text: 'Траки в норме' },
        { text: 'Ходовая очищена' },
      ] },
      { title: 'Безопасность', items: [
        { text: '4× аварийный стоп' },
        { text: 'Блокировка рычагов' },
        { text: 'Маячок' },
        { text: 'Ограничители подъёма/наклона/вылета' },
        { text: 'Сирена заднего хода' },
      ] },
      { title: 'Перед работой', items: [
        { text: 'Опасная зона свободна' },
        { text: 'Ветер', answerType: 'MEASURE', unit: 'м/с', norm: '≤20' },
        { text: 'Несущая способность грунта достаточна' },
        { text: 'Расстояние до ЛЭП', answerType: 'MEASURE', unit: 'м', norm: '3–6 по напряжению' },
        { text: 'Запас хода молота', answerType: 'MEASURE', unit: 'мм', norm: '150' },
      ] },
      { title: 'После смены', items: [
        D('Грузы на землю, рычаг разблокирования поднят'),
        D('Ключ извлечён, заперто'),
        D('Очистка машины'),
        D('Зафиксирована наработка'),
      ] },
    ],
  },

  // ─────────────── ROTARY · generic (no manual content yet)
  {
    name: 'ЕО — вращатель (общий)',
    blockType: 'ROTARY', level: 'EO',
    sections: [
      { title: 'Вращатель', items: [
        { text: 'Уровень масла в редукторе вращателя', answerType: 'MEASURE', norm: 'уточнить по регламенту', provenance: 'общий блок — заполнить по руководству' },
        { text: 'Нет течей редуктора' },
        { text: 'Шланги/РВД вращателя без повреждений' },
        { text: 'Крепление вращателя надёжно' },
        { text: 'Вращение без посторонних шумов и люфта' },
        D('Смазка узлов вращателя'),
      ] },
    ],
  },

  // ─────────────── BASE · generic fallback (any rig without a model block)
  {
    name: 'ЕО — база (общая, для любой установки)',
    blockType: 'BASE', level: 'EO', appliesToModel: null,
    sections: [
      { title: 'Внешний осмотр', items: [
        { text: 'Видимые повреждения/трещины конструкции', answerType: 'STATUS4', photoRequired: true },
        { text: 'Деформация мачты' },
        { text: 'Защитные кожухи на месте' },
        { text: 'Нет утечек жидкостей под машиной' },
      ] },
      { title: 'Двигатель', items: [
        { text: 'Уровень моторного масла', answerType: 'MEASURE' },
        { text: 'Уровень охлаждающей жидкости', answerType: 'MEASURE' },
        { text: 'Нет утечек топлива/масла/антифриза' },
        { text: 'Воздушный фильтр (загрязнённость)' },
      ] },
      { title: 'Гидросистема', items: [
        { text: 'Уровень гидравлического масла', answerType: 'MEASURE' },
        { text: 'Нет утечек масла' },
        { text: 'Состояние РВД (шланги ВД)' },
        { text: 'Гидроцилиндры (шток, утечки)' },
      ] },
      { title: 'Лебёдки и канаты', items: [
        { text: 'Состояние канатов', answerType: 'STATUS4', photoRequired: true },
        { text: 'Барабаны и тормоза лебёдок' },
      ] },
      { title: 'Ходовая часть', items: [
        { text: 'Гусеницы (состояние)' },
        { text: 'Катки и ведущие колёса' },
      ] },
      { title: 'Электрооборудование и безопасность', items: [
        { text: 'Аккумуляторы (заряд/клеммы)', answerType: 'MEASURE' },
        { text: 'Освещение, звуковой сигнал' },
        { text: 'Аварийная остановка' },
        { text: 'Огнетушитель (наличие/срок)' },
      ] },
      { title: 'Пробный запуск', items: [
        { text: 'Запуск двигателя, нет посторонних шумов' },
        { text: 'Давление гидросистемы', answerType: 'MEASURE' },
        { text: 'Работа лебёдок и оборудования' },
      ] },
    ],
  },
];

async function main() {
  const tenantId = process.env.DEFAULT_TENANT_ID ?? 'orion';

  // Retire the old mislabeled seed (BASE/HHK7A "ЕО гидромолота" matched no machine).
  const retired = await db.checklistTemplate.updateMany({
    where: { tenantId, name: 'ЕО гидромолота', isActive: true },
    data: { isActive: false },
  });
  if (retired.count) console.log(`Retired old "ЕО гидромолота" (${retired.count})`);

  for (const b of BLOCKS) {
    const exists = await db.checklistTemplate.findFirst({ where: { tenantId, name: b.name } });
    if (exists) { console.log(`skip (exists): ${b.name}`); continue; }
    await db.checklistTemplate.create({
      data: {
        tenantId, name: b.name, level: b.level, blockType: b.blockType,
        appliesToModel: b.appliesToModel ?? null,
        appliesToHammerKind: b.appliesToHammerKind ?? null,
        sections: {
          create: b.sections.map((s, si) => ({
            tenantId, title: s.title, order: si,
            items: {
              create: s.items.map((it, ii) => ({
                tenantId, text: it.text, answerType: it.answerType ?? 'YES_NO',
                unit: it.unit ?? null, norm: it.norm ?? null, provenance: it.provenance ?? null,
                photoRequired: it.photoRequired ?? false, required: true, order: ii,
              })),
            },
          })),
        },
      },
    });
    const items = b.sections.reduce((n, s) => n + s.items.length, 0);
    console.log(`created: ${b.name}  [${b.blockType}/${b.level}]  ${b.sections.length} разд., ${items} пунктов`);
  }

  await db.$disconnect();
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
