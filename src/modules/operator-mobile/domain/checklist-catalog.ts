import type {ChecklistDefinition, ChecklistStage} from './checklist-types';

/**
 * Чек-листы смены машиниста сваебойной установки.
 *
 * ПРАВИЛО СОСТАВА. В список попадает пункт, который отвечает «да» хотя бы на
 * один вопрос: может ли его пропуск убить человека, остановить машину на сутки
 * или сорвать сдачу работ? Всё остальное — руководство по эксплуатации, а не
 * чек-лист. Отсюда 6–17 пунктов на этап под секциями по узлам.
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
    version: '2.0',
    title: 'Предсменный осмотр',
    purpose: 'Обход холодной машины до пуска. Ищем то, что не видно на ходу.',
    sections: [
      {
        id: 'cabin',
        title: 'Кабина и обзор',
        items: [
          {
            id: 'glass',
            text: 'Стёкла кабины и зеркала целы, обзор чистый',
            hint: 'Трещина в лобовом на морозе расходится за смену',
            severity: 'NOTE',
            photoOnIssue: true,
          },
          {
            id: 'dark-lights',
            text: 'Рабочее и аварийное освещение, проблесковый маяк исправны',
            severity: 'ALERT',
            onlyWhen: ['DARK'],
          },
        ],
      },
      {
        id: 'undercarriage',
        title: 'Ходовая',
        items: [
          {
            id: 'undercarriage',
            text: 'Гусеницы, натяжение, катки, звёздочки',
            hint: 'Провисание, потеря пальцев, трещины на башмаках',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'frost-ice',
            text: 'Гусеницы не примёрзли, наледь из-под ходовой убрана',
            hint: 'Срыв примёрзшей гусеницы рвёт башмаки и пальцы',
            severity: 'ALERT',
            onlyWhen: ['FROST'],
          },
        ],
      },
      {
        id: 'mast',
        title: 'Мачта, молот, тросы',
        items: [
          {
            id: 'mast',
            text: 'Мачта и стрела: сварные швы, деформации, крепёж',
            hint: 'Трещина в мачте — работать нельзя, сообщите диспетчеру',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'hammer',
            text: 'Молот: крепление, корпус, рукава',
            severity: 'ALERT',
            photoOnIssue: true,
            unit: 'HAMMER',
          },
          {
            id: 'rotator',
            text: 'Вращатель и буровой инструмент: крепление, замки',
            severity: 'ALERT',
            photoOnIssue: true,
            unit: 'ROTATOR',
          },
          {
            id: 'ropes',
            text: 'Тросы: обрывы прядей, износ, крепление коушей',
            hint: 'Обрывы на длине одного шага свивки — трос под замену',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'hook',
            text: 'Крюковая обойма: замок исправен',
            hint: 'Отказ замка — падение груза',
            severity: 'ALERT',
          },
        ],
      },
      {
        id: 'engine',
        title: 'Двигатель',
        items: [
          {
            id: 'engine-oil',
            text: 'Уровень масла двигателя',
            severity: 'NOTE',
            measure: {key: 'engineOilL', label: 'Долито масла', unit: 'л', requiredOn: ['REMARK', 'FAULT']},
          },
          {
            id: 'coolant',
            text: 'Уровень охлаждающей жидкости',
            severity: 'NOTE',
            measure: {key: 'coolantL', label: 'Долито ОЖ', unit: 'л', requiredOn: ['REMARK', 'FAULT']},
          },
          {
            id: 'fuel-system',
            text: 'Топливная аппаратура и шланги: подтёков нет',
            hint: 'Соляра на горячем коллекторе — это пожар',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'frost-preheat',
            text: 'Предпусковой подогрев исправен, топливо зимнее',
            hint: 'Летняя соляра на морозе парафинится и встаёт колом',
            severity: 'NOTE',
            onlyWhen: ['FROST'],
          },
        ],
      },
      {
        id: 'hydraulics',
        title: 'Гидравлика',
        items: [
          {
            id: 'hydraulic-level',
            text: 'Уровень масла в гидробаке',
            severity: 'NOTE',
            measure: {key: 'hydraulicOilL', label: 'Долито гидромасла', unit: 'л', requiredOn: ['REMARK', 'FAULT']},
          },
          {
            id: 'hydraulic-hoses',
            text: 'Рукава РВД и соединения, подтёков нет',
            hint: 'Вздутие и «потение» соединения — предвестники разрыва',
            severity: 'ALERT',
            photoOnIssue: true,
          },
        ],
      },
      {
        id: 'general',
        title: 'Общее',
        items: [
          {
            id: 'leaks-ground',
            text: 'Под машиной сухо: пятен масла, ОЖ, топлива нет',
            severity: 'NOTE',
            photoOnIssue: true,
          },
          {
            id: 'safety-kit',
            text: 'Огнетушитель, аптечка, упоры, ограждения на месте',
            severity: 'ALERT',
          },
          {
            id: 'rain-steps',
            text: 'Ступени и поручни очищены от грязи и льда',
            hint: 'Падение с трапа — самая частая травма в распутицу',
            severity: 'NOTE',
            onlyWhen: ['RAIN', 'FROST'],
          },
        ],
      },
    ],
  },
  {
    stage: 'EO_BEFORE',
    version: '2.1',
    title: 'ЕО перед работой',
    purpose: 'Пуск, прогрев и холостая проверка. Машина показывает себя без нагрузки.',
    sections: [
      {
        id: 'start',
        title: 'Пуск и прогрев',
        items: [
          {
            id: 'start',
            text: 'Двигатель запущен, давление масла в норме, аварийных ламп нет',
            severity: 'ALERT',
          },
          {
            id: 'ecu',
            text: 'Ошибок блока управления двигателем нет',
            hint: 'Машина сообщает о неисправности сама, если посмотреть',
            severity: 'NOTE',
          },
          {
            id: 'warmup',
            text: 'Прогрет до рабочей температуры ОЖ и гидромасла',
            hint: 'Нагружать холодную гидравлику — это ремонт насоса',
            severity: 'ALERT',
            measure: {key: 'warmupMin', label: 'Прогрев', unit: 'мин'},
          },
          {
            id: 'frost-hydraulic-warmup',
            text: 'Гидромасло прогрето до рабочей вязкости перед нагрузкой',
            hint: 'На морозе гидравлика греется дольше двигателя',
            severity: 'ALERT',
            onlyWhen: ['FROST'],
          },
        ],
      },
      {
        id: 'idle',
        title: 'Холостая проверка',
        items: [
          {
            id: 'noise',
            text: 'Посторонних шумов двигателя и насосов нет',
            hint: 'Стук, вой насоса, свист — глушим и зовём механика',
            severity: 'ALERT',
          },
          {
            id: 'mast-motion',
            text: 'Ход мачты и стрелы: подъём и опускание без рывков',
            severity: 'ALERT',
          },
          {
            id: 'winch',
            text: 'Лебёдки: подъём, опускание, тормоз держит',
            hint: 'Тормоз проверяем под грузом, а не на слух',
            severity: 'ALERT',
          },
          {
            id: 'slew',
            text: 'Поворот платформы плавный, без стука и заеданий',
            severity: 'NOTE',
          },
          {
            id: 'travel',
            text: 'Передвижение: обе гусеницы и бортовые редукторы',
            severity: 'ALERT',
          },
          {
            id: 'controls',
            text: 'Приборы, звуковой сигнал, аварийный стоп исправны',
            severity: 'ALERT',
          },
        ],
      },
      {
        id: 'service',
        title: 'Обслуживание',
        items: [
          {
            id: 'grease',
            text: 'Смазка узлов по карте смазки выполнена',
            severity: 'NOTE',
          },
          {
            // Единственное место, где моточасы попадают в журнал наработки:
            // на приёме установки их не спрашивают, а планы ТО без них слепнут.
            id: 'meter',
            text: 'Показание моточасов снято',
            severity: 'ALERT',
            measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
          },
        ],
      },
    ],
  },
  {
    stage: 'SITE_READY',
    version: '2.0',
    title: 'Готовность площадки',
    purpose: 'Машина исправна — теперь под ней должно быть на чём стоять.',
    sections: [
      {
        id: 'base',
        title: 'Основание',
        items: [
          {
            id: 'ground',
            text: 'Основание плотное и устойчивое, установка не проседает',
            hint: 'Просадка под одной гусеницей при развороте — опрокидывание',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'level',
            text: 'Машина выровнена, уклон в допуске по руководству',
            severity: 'ALERT',
          },
          {
            id: 'frost-snow',
            text: 'Снег и наледь с рабочей площадки убраны',
            hint: 'Под снегом не видно ни колеи, ни просадки',
            severity: 'ALERT',
            onlyWhen: ['FROST'],
          },
          {
            id: 'rain-bearing',
            text: 'Основание не размокло, при необходимости отсыпка или плиты',
            severity: 'ALERT',
            photoOnIssue: true,
            onlyWhen: ['RAIN'],
          },
        ],
      },
      {
        id: 'zone',
        title: 'Зона работ',
        items: [
          {
            id: 'clearance',
            text: 'Габариты выдержаны: ЛЭП, здания, соседняя техника',
            hint: 'Расстояние до проводов — по наряду-допуску, «на глаз» нельзя',
            severity: 'ALERT',
          },
          {
            id: 'maneuver',
            text: 'Доступ для манёвра обеспечен',
            hint: 'Есть куда развернуться и отойти, не подрезая основание',
            severity: 'ALERT',
          },
          {
            id: 'obstacles',
            text: 'Препятствия отсутствуют',
            severity: 'ALERT',
          },
          {
            id: 'lighting',
            text: 'Освещённость рабочей зоны достаточна',
            hint: 'Исправных фар мало — нужна освещённость самой зоны',
            severity: 'ALERT',
            onlyWhen: ['DARK'],
          },
        ],
      },
    ],
  },
  {
    stage: 'TB_PILING',
    version: '2.0',
    title: 'ТБ: забивка свай',
    purpose: 'Что должно быть верно каждый раз, когда молот идёт вверх.',
    sections: [
      {
        id: 'people',
        title: 'Люди и связь',
        items: [
          {
            id: 'ppe',
            text: 'СИЗ надеты: каска, жилет, защита слуха, обувь',
            severity: 'ALERT',
          },
          {
            id: 'comms',
            text: 'Связь с помощником установлена: рация или условные знаки',
            hint: 'Потеряли связь — опускаем молот и останавливаемся',
            severity: 'ALERT',
          },
          {
            id: 'danger-zone',
            text: 'Опасная зона обозначена, помощник вне зоны падения сваи и молота',
            severity: 'ALERT',
          },
          {
            id: 'no-one-under',
            text: 'Под поднятой сваей и молотом людей нет и не будет',
            severity: 'ALERT',
          },
        ],
      },
      {
        id: 'rig',
        title: 'Груз и оснастка',
        items: [
          {
            id: 'slings',
            text: 'Стропы и захват сваи исправны, маркировка читается',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'cap',
            text: 'Наголовник соответствует типу сваи',
            hint: 'Чужой наголовник разбивает голову сваи и молот',
            severity: 'ALERT',
          },
          {
            id: 'hammer-secured',
            text: 'Молот закреплён, страховочный трос молота исправен',
            severity: 'ALERT',
            unit: 'HAMMER',
          },
          {
            id: 'wind',
            text: 'Ветер в допуске для подъёма сваи',
            hint: 'Порог прекращения работ — 15 м/с',
            severity: 'ALERT',
            onlyWhen: ['WIND'],
          },
        ],
      },
    ],
  },
  {
    stage: 'TB_DRILLING',
    version: '2.0',
    title: 'ТБ: лидерное бурение',
    purpose: 'Вращающийся шнек прощает меньше, чем молот.',
    sections: [
      {
        id: 'people',
        title: 'Люди и зона',
        items: [
          {
            id: 'ppe',
            text: 'СИЗ надеты, свободной одежды и шарфов нет',
            hint: 'Шнек затягивает одежду быстрее, чем человек успевает отпрянуть',
            severity: 'ALERT',
          },
          {
            id: 'rotation-zone',
            text: 'Зона вращения шнека ограждена, людей в ней нет',
            severity: 'ALERT',
          },
          {
            id: 'open-hole',
            text: 'Готовая скважина закрыта либо обозначена ограждением',
            hint: 'Открытый лидер — это провал ноги и перелом',
            severity: 'ALERT',
          },
        ],
      },
      {
        id: 'tool',
        title: 'Инструмент и проходка',
        items: [
          {
            id: 'survey',
            text: 'Точки бурения вынесены геодезистом',
            hint: 'Скважина не по проекту — переделка всего куста',
            severity: 'ALERT',
          },
          {
            id: 'tool-locked',
            text: 'Шнек и буровой инструмент закреплены, замки зафиксированы',
            severity: 'ALERT',
            unit: 'ROTATOR',
          },
          {
            id: 'vertical',
            text: 'Вертикальность мачты выставлена по уровню',
            hint: 'Увод скважины и лишняя нагрузка на вращатель',
            severity: 'ALERT',
          },
          {
            id: 'spoil',
            text: 'Извлечённый грунт отводится, основание под машиной не подрезано',
            severity: 'ALERT',
          },
          {
            id: 'estop',
            text: 'Аварийная остановка вращателя проверена',
            severity: 'ALERT',
          },
        ],
      },
    ],
  },
  {
    stage: 'EO_AFTER',
    version: '2.1',
    title: 'ЕО после работы',
    purpose: 'Что сделать до ухода, чтобы завтра машина завелась и поехала.',
    sections: [
      {
        id: 'park',
        title: 'Постановка',
        items: [
          {
            id: 'parked',
            text: 'Машина на ровном основании, мачта опущена на землю',
            severity: 'ALERT',
          },
          {
            id: 'frost-parking',
            text: 'Машина поставлена так, чтобы гусеницы не примёрзли',
            hint: 'Подкладки, отсыпка либо твёрдое сухое основание',
            severity: 'NOTE',
            onlyWhen: ['FROST'],
          },
        ],
      },
      {
        id: 'clean',
        title: 'Очистка',
        items: [
          {
            id: 'cabin-clean',
            text: 'Кабина очищена',
            severity: 'NOTE',
          },
          {
            id: 'tracks-clean',
            text: 'Гусеницы и ходовая очищены от грунта',
            hint: 'Грунт, замёрзший за ночь, утром снимается вместе с башмаком',
            severity: 'NOTE',
          },
        ],
      },
      {
        id: 'after',
        title: 'Осмотр после работы',
        items: [
          {
            id: 'deformation',
            text: 'Осмотр на деформации и трещины: мачта, стрела, рама',
            severity: 'ALERT',
            photoOnIssue: true,
          },
          {
            id: 'leaks-after',
            text: 'Течи после смены: двигатель, гидравлика, редукторы',
            hint: 'На горячей машине течь видно там, где на холодной её нет',
            severity: 'NOTE',
            photoOnIssue: true,
          },
          {
            id: 'ropes-after',
            text: 'Тросы после смены: новых обрывов прядей нет',
            severity: 'ALERT',
            photoOnIssue: true,
          },
        ],
      },
      {
        id: 'closing',
        title: 'Заправка и заглушение',
        items: [
          {
            id: 'meter-after',
            text: 'Моточасы на конец смены сняты',
            hint: 'Разница с утренним показанием — наработка за смену',
            severity: 'ALERT',
            measure: {key: 'engineHours', label: 'Моточасы', unit: 'м/ч'},
          },
          {
            id: 'fuel-level',
            text: 'Остаток топлива снят с указателя',
            hint: 'Пойдёт в отчёт и покажется утром при приёме установки',
            severity: 'NOTE',
            measure: {key: 'fuelPercent', label: 'Остаток топлива', unit: '%'},
          },
          {
            id: 'frost-fuel',
            text: 'Бак заправлен под пробку, конденсат слит',
            hint: 'Полупустой бак за ночь набирает воду, вода замерзает в фильтре',
            severity: 'NOTE',
            onlyWhen: ['FROST'],
          },
          {
            // Последний пункт смены намеренно: после него машина обесточена,
            // и вернуться к предыдущим пунктам уже нельзя.
            id: 'shutdown',
            text: 'Двигатель заглушен, масса отключена, кабина закрыта',
            severity: 'ALERT',
          },
        ],
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
