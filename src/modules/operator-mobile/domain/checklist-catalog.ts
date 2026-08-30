import type {ChecklistDefinition, ChecklistStage} from './checklist-types';

/**
 * Чек-листы смены машиниста сваебойной установки.
 *
 * ПРАВИЛО СОСТАВА. В список попадает пункт, который отвечает «да» хотя бы на
 * один вопрос: может ли его пропуск убить человека, остановить машину на сутки
 * или сорвать сдачу работ? Всё остальное — руководство по эксплуатации, а не
 * чек-лист. Отсюда 6–12 пунктов на этап: список, который читают, длиннее не
 * бывает.
 *
 * ПОЧЕМУ КОД, А НЕ СПРАВОЧНИК В БАЗЕ. Состав пунктов — правила безопасности,
 * а не настройка: их меняют разбором происшествия, а не галочкой в админке.
 * Код даёт версию, ревью и историю изменений. При запуске чек-листа снимок его
 * определения уходит в базу (OperatorChecklistExecution.templateSnapshot),
 * поэтому старые смены навсегда помнят, по какому списку их принимали.
 */
export const OPERATOR_CHECKLISTS: ChecklistDefinition[] = [
  {
    stage: 'PRESHIFT_INSPECTION',
    version: '1.0',
    title: 'Предсменный осмотр',
    purpose: 'Обход холодной машины до пуска. Ищем то, что не видно на ходу.',
    items: [
      {
        id: 'glass',
        text: 'Стёкла кабины и зеркала целы, обзор чистый',
        hint: 'Трещина в лобовом на морозе расходится за смену',
        blocking: false,
        photoOnIssue: true,
      },
      {
        id: 'undercarriage',
        text: 'Ходовая: гусеницы, натяжение, катки, звёздочки',
        hint: 'Провисание, потеря пальцев, трещины на башмаках',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'mast',
        text: 'Мачта и стрела: сварные швы, деформации, крепёж',
        hint: 'Трещина в мачте — работа запрещена',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'hammer',
        text: 'Молот: крепление, корпус, рукава',
        blocking: true,
        photoOnIssue: true,
        unit: 'HAMMER',
      },
      {
        id: 'rotator',
        text: 'Вращатель и буровой инструмент: крепление, замки',
        blocking: true,
        photoOnIssue: true,
        unit: 'ROTATOR',
      },
      {
        id: 'ropes',
        text: 'Тросы: обрывы прядей, износ, крепление коушей',
        hint: 'Обрывы прядей на длине одного шага свивки — трос под замену',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'engine-oil',
        text: 'Двигатель: уровень масла',
        blocking: false,
        measure: {key: 'engineOilL', label: 'Долито масла', unit: 'л', requiredOn: ['REMARK']},
      },
      {
        id: 'coolant',
        text: 'Двигатель: уровень охлаждающей жидкости',
        blocking: false,
        measure: {key: 'coolantL', label: 'Долито ОЖ', unit: 'л', requiredOn: ['REMARK']},
      },
      {
        id: 'fuel-system',
        text: 'Топливная аппаратура и шланги: подтёков нет',
        hint: 'Соляра на горячем коллекторе — это пожар',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'hydraulic-level',
        text: 'Гидравлика: уровень масла в баке',
        blocking: false,
        measure: {key: 'hydraulicOilL', label: 'Долито гидромасла', unit: 'л', requiredOn: ['REMARK']},
      },
      {
        id: 'hydraulic-hoses',
        text: 'Гидравлика: рукава РВД и соединения, подтёков нет',
        hint: 'Вздутие рукава и «потение» соединения — предвестники разрыва',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'leaks-ground',
        text: 'Под машиной сухо: пятен масла, ОЖ, топлива нет',
        blocking: false,
        photoOnIssue: true,
      },
      {
        id: 'safety-kit',
        text: 'Огнетушитель, аптечка, упоры, ограждения на месте',
        blocking: true,
      },
      {
        id: 'frost-preheat',
        text: 'Предпусковой подогрев исправен, топливо зимнее',
        hint: 'Летняя соляра на морозе парафинится и встаёт колом',
        blocking: false,
        onlyWhen: ['FROST'],
      },
      {
        id: 'frost-ice',
        text: 'Гусеницы не примёрзли, наледь из-под ходовой убрана',
        hint: 'Срыв примёрзшей гусеницы рвёт башмаки и пальцы',
        blocking: true,
        onlyWhen: ['FROST'],
      },
      {
        id: 'rain-steps',
        text: 'Ступени и поручни очищены от грязи и льда',
        hint: 'Падение с трапа — самая частая травма в распутицу',
        blocking: false,
        onlyWhen: ['RAIN', 'FROST'],
      },
      {
        id: 'dark-lights',
        text: 'Рабочее и аварийное освещение, проблесковый маяк исправны',
        blocking: true,
        onlyWhen: ['DARK'],
      },
    ],
  },
  {
    stage: 'EO_BEFORE',
    version: '1.0',
    title: 'ЕО перед работой',
    purpose: 'Пуск, прогрев и холостая проверка. Машина показывает себя без нагрузки.',
    items: [
      {
        id: 'start',
        text: 'Двигатель запущен, давление масла в норме, аварийных ламп нет',
        blocking: true,
      },
      {
        id: 'warmup',
        text: 'Прогрет до рабочей температуры ОЖ и гидромасла',
        hint: 'Нагружать холодную гидравлику — это ремонт насоса',
        blocking: true,
        measure: {key: 'warmupMin', label: 'Прогрев', unit: 'мин'},
      },
      {
        id: 'noise',
        text: 'Посторонних шумов двигателя и насосов нет',
        hint: 'Стук, вой насоса, свист — глушим и зовём механика',
        blocking: true,
      },
      {
        id: 'mast-motion',
        text: 'Ход мачты и стрелы: подъём и опускание без рывков',
        blocking: true,
      },
      {
        id: 'winch',
        text: 'Лебёдки: подъём, опускание, тормоз держит',
        hint: 'Тормоз проверяем под грузом, а не на слух',
        blocking: true,
      },
      {
        id: 'slew',
        text: 'Поворот платформы плавный, без стука и заеданий',
        blocking: true,
      },
      {
        id: 'travel',
        text: 'Передвижение: обе гусеницы и бортовые редукторы',
        blocking: true,
      },
      {
        id: 'grease',
        text: 'Смазка узлов по карте смазки выполнена',
        blocking: false,
      },
      {
        id: 'controls',
        text: 'Приборы, звуковой сигнал, аварийный стоп исправны',
        blocking: true,
      },
      {
        id: 'meter',
        text: 'Показание моточасов снято',
        blocking: true,
        measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
      },
      {
        id: 'frost-hydraulic-warmup',
        text: 'Гидромасло прогрето до рабочей вязкости перед нагрузкой',
        hint: 'На морозе гидравлика греется дольше двигателя',
        blocking: true,
        onlyWhen: ['FROST'],
      },
    ],
  },
  {
    stage: 'SITE_READY',
    version: '1.0',
    title: 'Готовность площадки',
    purpose: 'Машина исправна — теперь под ней должно быть на чём стоять.',
    items: [
      {
        id: 'ground',
        text: 'Основание плотное и устойчивое, установка не проседает',
        hint: 'Просадка под одной гусеницей при развороте — опрокидывание',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'level',
        text: 'Машина выровнена, уклон в допуске по руководству',
        blocking: true,
      },
      {
        id: 'clearance',
        text: 'Габариты выдержаны: ЛЭП, здания, соседняя техника',
        hint: 'Расстояние до проводов — по наряду-допуску, «на глаз» нельзя',
        blocking: true,
      },
      {
        id: 'utilities',
        text: 'Подземные коммуникации обозначены и согласованы',
        blocking: true,
      },
      {
        id: 'zone',
        text: 'Опасная зона ограждена, посторонних нет',
        blocking: true,
      },
      {
        id: 'escape',
        text: 'Подъезд и пути эвакуации свободны',
        blocking: false,
      },
      {
        id: 'frost-snow',
        text: 'Снег и наледь с рабочей площадки убраны',
        hint: 'Под снегом не видно ни колеи, ни просадки',
        blocking: true,
        onlyWhen: ['FROST'],
      },
      {
        id: 'rain-bearing',
        text: 'Основание не размокло, при необходимости отсыпка или плиты',
        blocking: true,
        photoOnIssue: true,
        onlyWhen: ['RAIN'],
      },
    ],
  },
  {
    stage: 'TB_PILING',
    version: '1.0',
    title: 'ТБ: забивка свай',
    purpose: 'Что должно быть верно каждый раз, когда молот идёт вверх.',
    items: [
      {
        id: 'ppe',
        text: 'СИЗ надеты: каска, жилет, защита слуха, обувь',
        blocking: true,
      },
      {
        id: 'danger-zone',
        text: 'Опасная зона обозначена, помощник вне зоны падения сваи и молота',
        blocking: true,
      },
      {
        id: 'comms',
        text: 'Связь с помощником установлена: рация или условные знаки',
        hint: 'Потеряли связь — опускаем молот и останавливаемся',
        blocking: true,
      },
      {
        id: 'slings',
        text: 'Стропы и захват сваи исправны, маркировка читается',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'hammer-secured',
        text: 'Молот закреплён, страховочный трос молота исправен',
        blocking: true,
        unit: 'HAMMER',
      },
      {
        id: 'wind',
        text: 'Ветер в допуске для подъёма сваи',
        hint: '20 м/с — работы прекращают, 36 м/с — стрелу в транспортное',
        blocking: true,
        onlyWhen: ['WIND'],
      },
      {
        id: 'no-one-under',
        text: 'Под поднятой сваей и молотом людей нет и не будет',
        blocking: true,
      },
    ],
  },
  {
    stage: 'TB_DRILLING',
    version: '1.0',
    title: 'ТБ: лидерное бурение',
    purpose: 'Вращающийся шнек прощает меньше, чем молот.',
    items: [
      {
        id: 'ppe',
        text: 'СИЗ надеты, свободной одежды и шарфов нет',
        hint: 'Шнек затягивает одежду быстрее, чем человек успевает отпрянуть',
        blocking: true,
      },
      {
        id: 'rotation-zone',
        text: 'Зона вращения шнека ограждена, людей в ней нет',
        blocking: true,
      },
      {
        id: 'tool-locked',
        text: 'Шнек и буровой инструмент закреплены, замки зафиксированы',
        blocking: true,
        unit: 'ROTATOR',
      },
      {
        id: 'spoil',
        text: 'Извлечённый грунт отводится, основание под машиной не подрезано',
        blocking: true,
      },
      {
        id: 'estop',
        text: 'Аварийная остановка вращателя проверена',
        blocking: true,
      },
      {
        id: 'open-hole',
        text: 'Готовая скважина закрыта либо обозначена ограждением',
        hint: 'Открытый лидер — это провал ноги и перелом',
        blocking: true,
      },
    ],
  },
  {
    stage: 'EO_AFTER',
    version: '1.0',
    title: 'ЕО после работы',
    purpose: 'Что сделать до ухода, чтобы завтра машина завелась и поехала.',
    items: [
      {
        id: 'parked',
        text: 'Машина на ровном основании, мачта в транспортном положении',
        blocking: true,
      },
      {
        id: 'shutdown',
        text: 'Двигатель заглушен, масса отключена, кабина закрыта',
        blocking: true,
      },
      {
        id: 'cabin-clean',
        text: 'Кабина очищена',
        blocking: false,
      },
      {
        id: 'tracks-clean',
        text: 'Гусеницы и ходовая очищены от грунта',
        hint: 'Грунт, замёрзший за ночь, утром снимается вместе с башмаком',
        blocking: false,
      },
      {
        id: 'deformation',
        text: 'Осмотр на деформации и трещины: мачта, стрела, рама',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'leaks-after',
        text: 'Течи после смены: двигатель, гидравлика, редукторы',
        hint: 'На горячей машине течь видно там, где на холодной её нет',
        blocking: false,
        photoOnIssue: true,
      },
      {
        id: 'ropes-after',
        text: 'Тросы после смены: новых обрывов прядей нет',
        blocking: true,
        photoOnIssue: true,
      },
      {
        id: 'meter-after',
        text: 'Моточасы на конец смены сняты',
        blocking: true,
        measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
      },
      {
        id: 'frost-fuel',
        text: 'Бак заправлен под пробку, конденсат слит',
        hint: 'Полупустой бак за ночь набирает воду, вода замерзает в фильтре',
        blocking: false,
        onlyWhen: ['FROST'],
      },
      {
        id: 'frost-parking',
        text: 'Машина поставлена так, чтобы гусеницы не примёрзли',
        hint: 'Подкладки, отсыпка либо твёрдое сухое основание',
        blocking: false,
        onlyWhen: ['FROST'],
      },
    ],
  },
];

const BY_STAGE = new Map(OPERATOR_CHECKLISTS.map((list) => [list.stage, list]));

export function getChecklist(stage: ChecklistStage): ChecklistDefinition {
  const definition = BY_STAGE.get(stage);
  if (!definition) throw new Error(`Неизвестный чек-лист: ${stage}`);
  return definition;
}
