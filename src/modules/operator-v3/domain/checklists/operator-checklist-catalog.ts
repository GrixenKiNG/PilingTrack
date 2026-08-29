import {CRITICAL_OPERATOR_RULES} from './operator-checklist-rules';
import type {
  OperatorChecklistAnswerType,
  OperatorChecklistCriticality,
  OperatorChecklistItemDefinition,
  OperatorChecklistSectionDefinition,
  OperatorChecklistStage,
  OperatorChecklistTemplateDefinition,
  SelectOperatorChecklistTemplateInput,
} from './operator-checklist-types';

type ItemOptions = Partial<Pick<OperatorChecklistItemDefinition,
  'answerType' | 'criticality' | 'required' | 'photoOnFailure' | 'unit' | 'ruleCode'>>;

function item(id: string, text: string, options: ItemOptions = {}): OperatorChecklistItemDefinition {
  return {
    id,
    text,
    answerType: options.answerType ?? 'PASS_FAIL_NA',
    criticality: options.criticality ?? 'NORMAL',
    required: options.required ?? true,
    photoOnFailure: options.photoOnFailure ?? true,
    unit: options.unit ?? null,
    ruleCode: options.ruleCode ?? null,
  };
}

function items(prefix: string, texts: string[], options: ItemOptions = {}): OperatorChecklistItemDefinition[] {
  return texts.map((text, index) => item(`${prefix}-${index + 1}`, text, options));
}

function section(id: string, title: string, sectionItems: OperatorChecklistItemDefinition[]): OperatorChecklistSectionDefinition {
  return {id, title, items: sectionItems};
}

const preShiftSections: OperatorChecklistSectionDefinition[] = [
  section('general', 'Общий визуальный осмотр', items('general', [
    'Корпус не имеет повреждений', 'Нет следов удара', 'Нет трещин', 'Нет деформаций',
    'Все элементы на месте', 'Все детали закреплены', 'Под машиной нет течей', 'Нет посторонних предметов',
  ])),
  section('cabin', 'Кабина', items('cabin', [
    'Стекла целы', 'На стеклах нет критических трещин', 'Обзорность не ограничена',
    'Зеркала и камеры целы', 'Зеркала и камеры чистые', 'Зеркала и камеры работают',
    'Двери открываются', 'Двери закрываются', 'Двери фиксируются',
    'Сиденье закреплено', 'Сиденье регулируется',
    'Ремень безопасности установлен', 'Ремень безопасности исправен', 'Замок ремня работает',
    'Органы управления не повреждены', 'Органы управления имеют свободный ход', 'Аварийная кнопка доступна',
    'Приборная панель работает', 'Аварийные лампы работают', 'Звуковая сигнализация работает',
    'Огнетушитель в наличии', 'Огнетушитель доступен', 'Пломба огнетушителя цела', 'Срок проверки огнетушителя действует',
    'Аптечка в наличии', 'Аптечка укомплектована', 'Срок годности аптечки действует',
  ])),
  section('undercarriage', 'Шасси и ходовая часть', [
    ...items('undercarriage', [
      'Гусеничные башмаки исправны', 'Крепления ходовой исправны', 'Пальцы ходовой зафиксированы',
      'Натяжение гусениц соответствует норме', 'Направляющие колёса исправны', 'Ведущие звёздочки исправны',
      'Опорные катки исправны', 'Поддерживающие катки исправны', 'Редукторы хода исправны',
      'Нет подтёков', 'Нет механических повреждений', 'В ходовой нет посторонних предметов',
    ]),
    item('undercarriage-stability', 'Ходовая не имеет повреждений, способных привести к потере устойчивости', {
      criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.stability,
    }),
  ]),
  section('mast', 'Мачта, лидер и стрела', [
    ...items('mast', [
      'Металлоконструкция исправна', 'Сварные швы не повреждены', 'Пальцы исправны', 'Оси исправны',
      'Стопорные элементы установлены', 'Направляющие исправны', 'Каретки исправны', 'Крепления исправны',
      'Цилиндры подъёма исправны', 'Трубопроводы исправны', 'Ограничители исправны', 'Датчики исправны',
    ]),
    item('mast-no-cracks', 'Нет трещин металлоконструкции мачты, лидера или стрелы', {
      criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.mastIntegrity,
    }),
    item('mast-no-deformation', 'Нет деформации несущих элементов', {criticality: 'CRITICAL'}),
    item('mast-pins-locked', 'Стопоры пальцев установлены и зафиксированы', {criticality: 'CRITICAL'}),
  ]),
  section('hammer', 'Молот', items('hammer', [
    'Крепление молота исправно', 'Направляющие исправны', 'Болты затянуты', 'Пальцы зафиксированы',
    'Подушки исправны', 'Шланги исправны', 'Гидролинии исправны', 'Кабели исправны',
    'Нет видимых течей', 'Нет трещин', 'Корпус не повреждён', 'Рабочий инструмент исправен',
    'Наголовник исправен', 'Амортизаторы исправны',
  ])),
  section('engine', 'Двигатель и жидкости', [
    ...items('engine', [
      'Нет подтёков моторного масла', 'Нет подтёков топлива', 'Нет подтёков охлаждающей жидкости',
      'Шланги не повреждены', 'Патрубки не повреждены', 'Крепления исправны', 'Электропроводка исправна', 'Ремни исправны',
    ]),
    item('engine-oil-level', 'Уровень моторного масла', {answerType: 'QUANTITY', unit: 'л', criticality: 'IMPORTANT'}),
    item('engine-coolant-level', 'Уровень охлаждающей жидкости', {answerType: 'QUANTITY', unit: 'л', criticality: 'IMPORTANT'}),
    item('engine-fuel-level', 'Уровень топлива', {answerType: 'QUANTITY', unit: 'л', criticality: 'IMPORTANT'}),
    item('engine-water-separator', 'Водоотделитель исправен и не требует слива', {criticality: 'IMPORTANT'}),
  ]),
  section('hydraulics', 'Гидравлическая система', [
    ...items('hydraulics', [
      'Уровень гидравлического масла соответствует норме', 'Бак исправен', 'Индикатор уровня работает',
      'Насосы исправны', 'Гидромоторы исправны', 'Гидрораспределители исправны', 'Цилиндры исправны',
      'Соединения герметичны', 'Шланги исправны', 'Фитинги исправны', 'Нет утечек',
      'Оболочка рукавов не повреждена', 'Нет следов перетирания',
    ]),
    item('hydraulics-hose-integrity', 'Рукава высокого давления не повреждены до корда и не имеют вздутий', {
      criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.hydraulicIntegrity,
    }),
    item('hydraulics-no-jet-leak', 'Нет струйной или сильной утечки', {criticality: 'CRITICAL'}),
  ]),
  section('ropes', 'Тросы', [
    item('ropes-integrity', 'Тросы не имеют обрывов, заломов, сплющивания и распушения', {
      criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.ropeIntegrity,
    }),
    ...items('ropes', [
      'Нет коррозии', 'Нет локального уменьшения диаметра', 'Барабан не повреждён',
      'Трос уложен правильно', 'Канавки блоков исправны', 'Коуши исправны', 'Конец троса закреплён',
      'Трос не перекручен', 'Нет иных видимых повреждений проволок', 'Трос соответствует направлению укладки',
      'Зона прохождения троса свободна',
    ]),
  ]),
  section('winches', 'Лебёдки', items('winches', [
    'Корпус исправен', 'Тормоз исправен', 'Барабан исправен', 'Редуктор исправен', 'Трос исправен',
    'Направляющие исправны', 'Крепления исправны', 'Нет утечек', 'При проверке нет постороннего шума',
  ])),
  section('electrics', 'Электрика', [
    ...items('electrics', [
      'Аккумуляторы исправны', 'Клеммы закреплены', 'Кабели исправны', 'Разъёмы исправны',
      'Изоляция не повреждена', 'Освещение работает', 'Рабочие фары работают', 'Проблесковый маяк работает',
      'Звуковой сигнал работает',
    ]),
    item('electrics-emergency-stop', 'Аварийная остановка работает', {
      criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.emergencyStop,
    }),
  ]),
];

const siteSections: OperatorChecklistSectionDefinition[] = [
  section('site-foundation', 'Основание', [
    ...items('site-foundation', [
      'Площадка спланирована', 'Нет очевидных провалов', 'Нет размокшего основания',
      'Нет незащищённых траншей', 'Нет опасных уклонов', 'Площадка выдерживает установку',
      'Ширины достаточно для маневрирования',
    ], {criticality: 'IMPORTANT'}),
    item('site-foundation-stable', 'Основание плотное и устойчивое, установка не потеряет устойчивость', {
      criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.stability,
    }),
  ]),
  section('site-hazards', 'Опасные зоны', items('site-hazards', [
    'Учтены линии электропередачи', 'Учтены подземные коммуникации', 'Учтены котлованы', 'Учтены траншеи',
    'Учтены здания', 'Учтены ограждения', 'Учтена сторонняя техника', 'В рабочей зоне нет людей',
    'Определена зона складирования свай', 'Определён маршрут перемещения', 'Определена зона разворота',
    'Определена зона падения груза',
  ], {criticality: 'IMPORTANT'})),
  section('pile-storage', 'Складирование свай', items('pile-storage', [
    'Штабель устойчив', 'Прокладки установлены', 'Упоры установлены', 'Доступ установки или крана обеспечен',
    'Безопасная строповка возможна', 'В опасной зоне нет людей',
  ], {criticality: 'IMPORTANT'})),
];

const startupSections: OperatorChecklistSectionDefinition[] = [
  section('engine-start', 'Запуск двигателя', [
    item('engine-start-time', 'Время запуска', {answerType: 'TEXT', photoOnFailure: false}),
    item('engine-start-meter', 'Моточасы при запуске', {answerType: 'NUMBER', unit: 'м/ч', photoOnFailure: false}),
  ]),
  section('warmup', 'Прогрев', [
    item('warmup-coolant', 'Температура охлаждающей жидкости в рабочем диапазоне', {answerType: 'TEMPERATURE', unit: '°C', criticality: 'IMPORTANT'}),
    item('warmup-hydraulic', 'Температура гидравлики в рабочем диапазоне', {answerType: 'TEMPERATURE', unit: '°C', criticality: 'IMPORTANT'}),
  ]),
  section('travel-test', 'Ход', items('travel-test', ['Движение вперёд исправно', 'Движение назад исправно', 'Левый ход исправен', 'Правый ход исправен', 'Торможение исправно'], {criticality: 'IMPORTANT'})),
  section('swing-test', 'Поворот башни', items('swing-test', ['Поворот влево исправен', 'Поворот вправо исправен', 'Движение плавное', 'Нет постороннего шума'], {criticality: 'IMPORTANT'})),
  section('mast-test', 'Мачта', items('mast-test', ['Подъём исправен', 'Опускание исправно', 'Наклон исправен', 'Цилиндры работают штатно', 'Фиксация работает'], {criticality: 'IMPORTANT'})),
  section('winch-test', 'Лебёдки', items('winch-test', ['Главная лебёдка работает', 'Вспомогательная лебёдка работает'], {criticality: 'IMPORTANT'})),
  section('hammer-test', 'Молот', items('hammer-test', ['Подъём и спуск работают', 'Перемещение работает', 'Направляющие работают штатно'], {criticality: 'IMPORTANT'})),
  section('drill-test', 'Буровое оборудование', items('drill-test', ['Вращатель работает', 'Подача работает', 'Лебёдка работает', 'Вращение работает', 'Остановка работает', 'Реверс работает'], {criticality: 'IMPORTANT'})),
  section('noise-vibration', 'Шумы и вибрации', [
    item('unusual-noise', 'Посторонних шумов нет', {answerType: 'YES_NO', criticality: 'IMPORTANT'}),
    item('unusual-vibration', 'Нетипичной вибрации нет', {answerType: 'YES_NO', criticality: 'IMPORTANT'}),
    item('jerks', 'Рывков нет', {answerType: 'YES_NO', criticality: 'IMPORTANT'}),
  ]),
];

const preWorkServiceSections: OperatorChecklistSectionDefinition[] = [
  section('service-engine', 'Двигатель', items('service-engine', ['Проверить масло', 'Проверить охлаждающую жидкость', 'Проверить топливо', 'Проверить ремни', 'Проверить утечки'], {answerType: 'ACTION_STATUS'})),
  section('service-hydraulics', 'Гидравлика', items('service-hydraulics', ['Проверить уровень масла', 'Проверить РВД', 'Проверить соединения', 'Проверить течи'], {answerType: 'ACTION_STATUS'})),
  section('service-undercarriage', 'Ходовая', items('service-undercarriage', ['Очистить ходовую', 'Проверить натяжение', 'Проверить башмаки', 'Проверить катки'], {answerType: 'ACTION_STATUS'})),
  section('service-mast', 'Мачта', items('service-mast', ['Проверить пальцы', 'Проверить направляющие', 'Проверить крепления', 'Смазать необходимые точки'], {answerType: 'ACTION_STATUS'})),
  section('service-winches', 'Лебёдки и тросы', items('service-winches', ['Осмотреть лебёдки и тросы', 'Проверить укладку троса', 'Смазать по регламенту'], {answerType: 'ACTION_STATUS'})),
  section('service-electrics', 'Электрика', items('service-electrics', ['Проверить освещение', 'Проверить маяк', 'Проверить сигнал', 'Проверить аварийную кнопку'], {answerType: 'ACTION_STATUS'})),
  section('service-cabin', 'Кабина', items('service-cabin', ['Очистить стекла', 'Очистить зеркала', 'Очистить камеры', 'Очистить рабочее место'], {answerType: 'ACTION_STATUS'})),
];

const pileSafetySections: OperatorChecklistSectionDefinition[] = [
  section('pile-machine', 'Машина', items('pile-machine', ['Установка стоит устойчиво', 'Мачта исправна', 'Молот закреплён', 'Трос исправен', 'Лебёдка исправна', 'Аварийная остановка работает'], {criticality: 'CRITICAL'})),
  section('pile-site', 'Площадка', items('pile-site', ['Основание устойчиво', 'Нет опасных провалов', 'Опасная зона определена', 'В зоне работы нет людей', 'Расстояние до котлована безопасно', 'Расстояние до ЛЭП безопасно'], {criticality: 'CRITICAL'})),
  section('pile-item', 'Свая', items('pile-item', ['Свая визуально исправна', 'Нет критических трещин', 'Строповка соответствует схеме', 'Наголовник соответствует свае', 'Свая установлена правильно'], {criticality: 'IMPORTANT'})),
  section('pile-team', 'Бригада', items('pile-team', ['Ответственные назначены', 'Сигналы согласованы', 'Связь со стропальщиком обеспечена', 'Под грузом никого нет', 'Между сваей и установкой никого нет'], {criticality: 'CRITICAL'})),
  section('pile-before-strike', 'Перед ударом', [
    ...items('pile-before-strike', ['Свая установлена', 'Опасная зона свободна', 'Строп снят или расположен безопасно', 'Молот установлен'], {criticality: 'CRITICAL'}),
    item('pile-strike-permission', 'Все условия безопасного удара выполнены', {criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.safePileStrike}),
  ]),
];

const drillingSafetySections: OperatorChecklistSectionDefinition[] = [
  section('drilling-tool', 'Буровой инструмент', items('drilling-tool', ['Шнек исправен', 'Соединения исправны', 'Пальцы исправны', 'Фиксаторы установлены', 'Вращатель исправен', 'Направляющие исправны', 'Крепления исправны'], {criticality: 'IMPORTANT'})),
  section('drilling-site', 'Площадка', items('drilling-site', ['Основание устойчиво', 'Пустот нет', 'Подземные коммуникации определены', 'Рабочая зона ограждена', 'Рядом со шнеком нет людей'], {criticality: 'CRITICAL'})),
  section('drilling-before-rotation', 'Перед запуском вращения', items('drilling-before-rotation', ['Инструмент свободен', 'Зона вращения свободна', 'Рядом никого нет', 'Соединения закрыты', 'Оператор видит рабочую зону'], {criticality: 'CRITICAL'})),
  section('drilling-auger-cleaning', 'Очистка шнека', [
    item('drilling-auger-cleaning-lockout', 'Вращение остановлено до ручной очистки', {criticality: 'CRITICAL', ruleCode: CRITICAL_OPERATOR_RULES.rotationStopped}),
    item('drilling-auger-fixed', 'Инструмент зафиксирован', {criticality: 'CRITICAL'}),
    item('drilling-auger-no-restart', 'Самопроизвольный запуск исключён', {criticality: 'CRITICAL'}),
  ]),
];

const postShiftSections: OperatorChecklistSectionDefinition[] = [
  section('post-cleaning', 'Очистка', items('post-cleaning', ['Очистить кабину', 'Очистить стекла', 'Очистить камеры', 'Очистить гусеницы', 'Очистить ходовую', 'Очистить рабочее оборудование', 'Очистить мачту', 'Очистить молот', 'Очистить буровой инструмент'], {answerType: 'ACTION_STATUS'})),
  section('post-structures', 'Металлоконструкции', items('post-structures', ['Нет новых трещин', 'Нет новых деформаций', 'Нет новых повреждений'], {criticality: 'IMPORTANT'})),
  section('post-hammer', 'Молот', items('post-hammer', ['Нет трещин', 'Крепления исправны', 'Нет течей'], {criticality: 'IMPORTANT'})),
  section('post-mast', 'Мачта', items('post-mast', ['Направляющие исправны', 'Пальцы исправны', 'Соединения исправны'], {criticality: 'IMPORTANT'})),
  section('post-hydraulics', 'Гидравлика', items('post-hydraulics', ['Нет новых течей', 'Нет новых повреждений РВД'], {criticality: 'IMPORTANT'})),
  section('post-ropes', 'Тросы', items('post-ropes', ['Нет новых повреждений', 'Нет обрывов проволок', 'Нет заломов'], {criticality: 'CRITICAL'})),
  section('post-undercarriage', 'Ходовая', items('post-undercarriage', ['Башмаки исправны', 'Катки исправны', 'Редукторы исправны', 'Нет течей'], {criticality: 'IMPORTANT'})),
];

const fluidSections: OperatorChecklistSectionDefinition[] = [
  section('post-fluids', 'Жидкости после смены', [
    item('post-engine-oil', 'Уровень масла двигателя после смены', {answerType: 'QUANTITY', unit: 'л'}),
    item('post-coolant', 'Уровень охлаждающей жидкости после смены', {answerType: 'QUANTITY', unit: 'л'}),
    item('post-hydraulic-oil', 'Уровень гидравлического масла после смены', {answerType: 'QUANTITY', unit: 'л'}),
    item('post-fuel', 'Остаток топлива после смены', {answerType: 'QUANTITY', unit: 'л'}),
  ]),
];

const stageSections: Record<OperatorChecklistStage, OperatorChecklistSectionDefinition[]> = {
  PRE_SHIFT: preShiftSections,
  SITE: siteSections,
  STARTUP: startupSections,
  PILE_SAFETY: pileSafetySections,
  DRILLING_SAFETY: drillingSafetySections,
  PRE_WORK_SERVICE: preWorkServiceSections,
  POST_SHIFT: postShiftSections,
  FLUIDS: fluidSections,
};

const stageNames: Record<OperatorChecklistStage, string> = {
  PRE_SHIFT: 'Предсменный осмотр', SITE: 'Проверка площадки', STARTUP: 'Запуск и прогрев',
  PILE_SAFETY: 'Безопасность забивки свай', DRILLING_SAFETY: 'Безопасность лидерного бурения',
  PRE_WORK_SERVICE: 'Ежесменное обслуживание перед работой', POST_SHIFT: 'Послесменное обслуживание и осмотр',
  FLUIDS: 'Жидкости после смены',
};

function cloneSections(sections: OperatorChecklistSectionDefinition[]): OperatorChecklistSectionDefinition[] {
  return sections.map((source) => ({...source, items: source.items.map((sourceItem) => ({...sourceItem}))}));
}

export function selectOperatorChecklistTemplate(input: SelectOperatorChecklistTemplateInput): OperatorChecklistTemplateDefinition {
  const technology = input.stage === 'PILE_SAFETY'
    ? 'PILE_DRIVING'
    : input.stage === 'DRILLING_SAFETY'
      ? 'LEADER_DRILLING'
      : input.technology;
  return {
    id: `operator-v3:${input.stage}:${input.equipmentModel.toLowerCase().replace(/[^a-zа-я0-9]+/giu, '-')}`,
    version: '2026.08.29',
    name: `${stageNames[input.stage]} — ${input.equipmentModel}`,
    stage: input.stage,
    equipmentModel: input.equipmentModel,
    technology,
    sections: cloneSections(stageSections[input.stage]),
  };
}

export type {OperatorChecklistTemplateDefinition};
