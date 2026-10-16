import {describe, expect, it} from 'vitest';
import {getChecklist} from '../checklist-catalog';
import {checklistItems, type ChecklistItem} from '../checklist-types';
import {validateChecklistRun, type ChecklistAnswer} from '../checklist-run';
import {selectChecklistItems} from '../shift-conditions';

/**
 * «Долил за смену» в ЕО после работы (16.10.2026): четыре необязательных замера в
 * литрах без вердикта «норма / замечание / отказ». Пусто — оператор не доливал.
 */
const TOP_UP_KEYS = ['coolantL', 'hydraulicOilL', 'engineOilL', 'dieselL'];

const eoAfter = () => checklistItems(getChecklist('EO_AFTER'));
const topUps = () => eoAfter().filter((item) => item.topUp);
const required = () => eoAfter().filter((item) => !item.topUp);

/** Ответы на все обязательные пункты ЕО: «норма» и нужные замеры. */
const answersForRequired = (): ChecklistAnswer[] => required().map((item) => ({
  itemId: item.id,
  answer: 'OK' as const,
  measures: item.measure ? {[item.measure.key]: item.measure.key === 'fuelPercent' ? 55 : 3010} : undefined,
}));

describe('каталог: долив в ЕО после работы', () => {
  it('содержит четыре жидкости в литрах, без вердикта и в порядке «антифриз, гидромасло, моторное, дизель»', () => {
    expect(topUps().map((item) => item.measure?.key)).toEqual(['coolantL', 'hydraulicOilL', 'engineOilL', 'dieselL']);
    expect(topUps().map((item) => item.text)).toEqual(['Антифриз', 'Гидравлическое масло', 'Моторное масло', 'Дизельное топливо']);
    for (const item of topUps()) {
      expect(item.measure?.unit).toBe('л');
      expect(item.measure?.min).toBe(0);
    }
  });

  it('стоит перед последним пунктом смены «двигатель заглушен»', () => {
    const ids = eoAfter().map((item) => item.id);
    expect(ids[ids.length - 1]).toBe('shutdown');
    expect(ids.indexOf('topup-diesel')).toBeLessThan(ids.indexOf('shutdown'));
    expect(ids.indexOf('topup-coolant')).toBeGreaterThan(ids.indexOf('fuel-level'));
  });

  it('все пункты долива имеют id с префиксом topup-: по нему история осмотров исключает их из счёта «нормы»', () => {
    expect(topUps().every((item) => item.id.startsWith('topup-'))).toBe(true);
    expect(eoAfter().filter((item) => item.id.startsWith('topup-'))).toHaveLength(topUps().length);
  });

  it('меняет версию списка: снимок состава уходит в базу', () => {
    expect(getChecklist('EO_AFTER').version).toBe('3.2');
  });

  it('предсменный осмотр не дублирует и не теряет свои доливы', () => {
    const pre = checklistItems(getChecklist('PRESHIFT_INSPECTION')).filter((item) => item.measure?.key.endsWith('L'));
    expect(pre.map((item) => item.measure?.key).sort()).toEqual(['coolantL', 'engineOilL', 'hydraulicOilL']);
    expect(pre.every((item) => !item.topUp)).toBe(true);
  });

  it('показывается при любых условиях смены и на любой установке', () => {
    const picked = selectChecklistItems(getChecklist('EO_AFTER'), ['FROST', 'RAIN'], {hasHammer: false, hasRotator: false});
    expect(picked.filter((item: ChecklistItem) => item.topUp)).toHaveLength(4);
  });
});

describe('validateChecklistRun: необязательные доливы', () => {
  it('без единого долива чек-лист принимается', () => {
    expect(validateChecklistRun(eoAfter(), answersForRequired())).toEqual([]);
  });

  it('принимает долив числом и ноль', () => {
    const answers: ChecklistAnswer[] = [
      ...answersForRequired(),
      {itemId: 'topup-diesel', answer: 'OK', measures: {dieselL: 120}},
      {itemId: 'topup-coolant', answer: 'OK', measures: {coolantL: 0}},
    ];
    expect(validateChecklistRun(eoAfter(), answers)).toEqual([]);
  });

  it('отклоняет отрицательный долив и называет жидкость', () => {
    const answers: ChecklistAnswer[] = [...answersForRequired(), {itemId: 'topup-engine-oil', answer: 'OK', measures: {engineOilL: -1}}];
    const problems = validateChecklistRun(eoAfter(), answers);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({itemId: 'topup-engine-oil'});
    expect(problems[0]?.message).toContain('Моторное масло');
  });

  it('отклоняет нечисловое значение и абсурдный объём', () => {
    const bad: ChecklistAnswer[] = [
      ...answersForRequired(),
      {itemId: 'topup-diesel', answer: 'OK', measures: {dieselL: Number.NaN}},
      {itemId: 'topup-coolant', answer: 'OK', measures: {coolantL: 100000}},
    ];
    expect(validateChecklistRun(eoAfter(), bad).map((problem) => problem.itemId).sort()).toEqual(['topup-coolant', 'topup-diesel']);
  });

  it('вердикт «замечание» у долива не требует описания и фото: это не осмотр', () => {
    const answers: ChecklistAnswer[] = [...answersForRequired(), {itemId: 'topup-diesel', answer: 'REMARK', measures: {dieselL: 5}}];
    expect(validateChecklistRun(eoAfter(), answers)).toEqual([]);
  });

  it('обязательные пункты по-прежнему обязательны', () => {
    const problems = validateChecklistRun(eoAfter(), answersForRequired().slice(1));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((problem) => !problem.itemId.startsWith('topup-'))).toBe(true);
  });

  it('ключи долива оканчиваются на L: сервер записывает их как события парка', () => {
    expect(TOP_UP_KEYS.every((key) => key.endsWith('L'))).toBe(true);
    expect(topUps().map((item) => item.measure?.key)).toEqual(TOP_UP_KEYS);
  });
});
