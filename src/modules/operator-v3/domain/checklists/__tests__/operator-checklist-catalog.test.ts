import {describe, expect, it} from 'vitest';
import {selectOperatorChecklistTemplate} from '../operator-checklist-catalog';

describe('каталог проверок оператора по новой спецификации', () => {
  it('не теряет ни одного обязательного раздела предсменного осмотра', () => {
    const template = selectOperatorChecklistTemplate({
      stage: 'PRE_SHIFT',
      equipmentModel: 'PVE 50PR',
      technology: null,
    });

    expect(template.sections.map((section) => section.title)).toEqual([
      'Общий визуальный осмотр',
      'Кабина',
      'Шасси и ходовая часть',
      'Мачта, лидер и стрела',
      'Молот',
      'Двигатель и жидкости',
      'Гидравлическая система',
      'Тросы',
      'Лебёдки',
      'Электрика',
    ]);
    expect(template.sections.flatMap((section) => section.items)).toHaveLength(135);
  });

  it('помечает опасные повреждения техники критическими', () => {
    const template = selectOperatorChecklistTemplate({stage: 'PRE_SHIFT', equipmentModel: 'PVE 50PR', technology: null});
    const criticalTexts = template.sections
      .flatMap((section) => section.items)
      .filter((item) => item.criticality === 'CRITICAL')
      .map((item) => item.text);

    expect(criticalTexts).toEqual(expect.arrayContaining([
      'Ходовая не имеет повреждений, способных привести к потере устойчивости',
      'Нет трещин металлоконструкции мачты, лидера или стрелы',
      'Рукава высокого давления не повреждены до корда и не имеют вздутий',
      'Тросы не имеют обрывов, заломов, сплющивания и распушения',
      'Аварийная остановка работает',
    ]));
  });

  it('содержит полные проверки площадки, запуска и обслуживания', () => {
    const input = {equipmentModel: 'PVE 50PR', technology: null} as const;
    expect(selectOperatorChecklistTemplate({...input, stage: 'SITE'}).sections.map((section) => section.title)).toEqual([
      'Основание', 'Опасные зоны', 'Складирование свай',
    ]);
    expect(selectOperatorChecklistTemplate({...input, stage: 'STARTUP'}).sections.map((section) => section.title)).toEqual([
      'Запуск двигателя', 'Прогрев', 'Ход', 'Поворот башни', 'Мачта', 'Лебёдки', 'Молот', 'Буровое оборудование', 'Шумы и вибрации',
    ]);
    expect(selectOperatorChecklistTemplate({...input, stage: 'PRE_WORK_SERVICE'}).sections.map((section) => section.title)).toEqual([
      'Двигатель', 'Гидравлика', 'Ходовая', 'Мачта', 'Лебёдки и тросы', 'Электрика', 'Кабина',
    ]);
  });

  it('выдаёт разные проверки безопасности для забивки и лидерного бурения', () => {
    const piles = selectOperatorChecklistTemplate({stage: 'PILE_SAFETY', equipmentModel: 'PVE 50PR', technology: 'PILE_DRIVING'});
    const drilling = selectOperatorChecklistTemplate({stage: 'DRILLING_SAFETY', equipmentModel: 'PVE 50PR', technology: 'LEADER_DRILLING'});

    expect(piles.sections.map((section) => section.title)).toEqual(['Машина', 'Площадка', 'Свая', 'Бригада', 'Перед ударом']);
    expect(drilling.sections.map((section) => section.title)).toEqual(['Буровой инструмент', 'Площадка', 'Перед запуском вращения', 'Очистка шнека']);
    expect(drilling.sections.flatMap((section) => section.items).find((item) => item.id === 'drilling-auger-cleaning-lockout')).toMatchObject({
      criticality: 'CRITICAL',
      ruleCode: 'ROTATION_MUST_BE_STOPPED',
    });
  });

  it('содержит все послесменные разделы и жидкости', () => {
    const input = {equipmentModel: 'PVE 50PR', technology: null} as const;
    expect(selectOperatorChecklistTemplate({...input, stage: 'POST_SHIFT'}).sections.map((section) => section.title)).toEqual([
      'Очистка', 'Металлоконструкции', 'Молот', 'Мачта', 'Гидравлика', 'Тросы', 'Ходовая',
    ]);
    expect(selectOperatorChecklistTemplate({...input, stage: 'FLUIDS'}).sections.flatMap((section) => section.items).map((item) => item.text)).toEqual([
      'Уровень масла двигателя после смены',
      'Уровень охлаждающей жидкости после смены',
      'Уровень гидравлического масла после смены',
      'Остаток топлива после смены',
    ]);
  });

  it('выбирает версионированные шаблоны с уникальными идентификаторами и русскими подписями', () => {
    const stages = [
      'PRE_SHIFT', 'SITE', 'STARTUP', 'PILE_SAFETY',
      'DRILLING_SAFETY', 'PRE_WORK_SERVICE', 'POST_SHIFT', 'FLUIDS',
    ] as const;

    for (const stage of stages) {
      const technology = stage === 'PILE_SAFETY'
        ? 'PILE_DRIVING'
        : stage === 'DRILLING_SAFETY'
          ? 'LEADER_DRILLING'
          : null;
      const template = selectOperatorChecklistTemplate({stage, equipmentModel: 'PVE 50PR', technology});
      const itemIds = template.sections.flatMap((section) => section.items.map((item) => item.id));

      expect(template.version).toBe('2026.08.29');
      expect(new Set(itemIds).size).toBe(itemIds.length);
      expect(template.sections.every((section) => /[А-Яа-яЁё]/u.test(section.title))).toBe(true);
      expect(template.sections.flatMap((section) => section.items).every((item) => /[А-Яа-яЁё]/u.test(item.text))).toBe(true);
    }
  });
});
