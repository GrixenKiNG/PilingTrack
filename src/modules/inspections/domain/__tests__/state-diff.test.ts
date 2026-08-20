import { describe, expect, it } from 'vitest';
import { describeStateChanges, diffInspectionStates } from '../state-diff';

describe('diffInspectionStates', () => {
  it('молчит, когда состояние не изменилось', () => {
    const answers = [{ text: 'Течи гидравлического масла', result: 'NORMAL' }];
    expect(diffInspectionStates(answers, answers)).toEqual([]);
  });

  it('видит ухудшение и называет его словами', () => {
    const changes = diffInspectionStates(
      [{ text: 'Течи гидравлического масла', result: 'NORMAL' }],
      [{ text: 'Течи гидравлического масла', result: 'FAIL' }],
    );
    expect(changes).toEqual([
      { text: 'Течи гидравлического масла', from: 'NORMAL', to: 'FAIL', worsened: true },
    ]);
    expect(describeStateChanges(changes)).toBe('Течи гидравлического масла: NORMAL → FAIL');
  });

  it('улучшение фиксирует, но ухудшением не считает', () => {
    const [change] = diffInspectionStates(
      [{ text: 'Износ тросов', result: 'WARNING' }],
      [{ text: 'Износ тросов', result: 'NORMAL' }],
    );
    expect(change.worsened).toBe(false);
    expect(describeStateChanges([change])).toBe('');
  });

  // Шаблоны до и после работ разные, совпадают только формулировки — и они
  // приходят из разных источников, поэтому регистр и ё/е не должны мешать.
  it('сопоставляет пункты по тексту, не придираясь к регистру и ё', () => {
    const changes = diffInspectionStates(
      [{ text: 'Состояние подбабка и амортизатора', result: 'NORMAL' }],
      [{ text: '  состояние подбабка и амортизатора ', result: 'WARNING' }],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].worsened).toBe(true);
  });

  it('пункт, которого не было в послесменном осмотре, не считает улучшением', () => {
    expect(diffInspectionStates(
      [{ text: 'Огнетушители', result: 'NORMAL' }, { text: 'Течи', result: 'FAIL' }],
      [{ text: 'Течи', result: 'FAIL' }],
    )).toEqual([]);
  });

  it('на непонятной паре ответов ухудшение не выдумывает', () => {
    const [change] = diffInspectionStates(
      [{ text: 'Давление в аккумуляторе', result: '150 бар' }],
      [{ text: 'Давление в аккумуляторе', result: '120 бар' }],
    );
    expect(change.worsened).toBe(false);
  });
});
