import { describe, expect, it } from 'vitest';
import {
  addMonths, evaluateBriefingRequirements, type BriefingHistoryEntry,
} from '../briefing-requirements';
import type { SafetyInstruction } from '../../instructions';

/**
 * Расчёт решает, кого назвать нарушителем, поэтому проверяется на границах, а
 * не «в среднем». Ошибка здесь — либо просроченный инструктаж, который никто
 * не заметил, либо честный работник в красном списке.
 */

const PILING: SafetyInstruction = {
  code: 'И-СМ-04',
  title: 'Безопасность при свайных работах',
  version: '2.0',
  audience: 'Машинист',
  requiredForRoles: ['OPERATOR'],
  repeatMonths: 3,
};

const NOW = new Date('2026-09-14T09:00:00.000Z');

const read = (version: string, recordedAt: string): BriefingHistoryEntry =>
  ({ documentCode: 'И-СМ-04', documentVersion: version, recordedAt });

describe('Требования по инструктажам', () => {
  it('не предъявляет требований роли, которой инструкция не назначена', () => {
    const result = evaluateBriefingRequirements([PILING], 'MECHANIC', [], NOW);
    expect(result.required).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
    expect(result.overdue).toHaveLength(0);
  });

  it('различает «не читал вовсе» и «читал прошлую редакцию»', () => {
    const never = evaluateBriefingRequirements([PILING], 'OPERATOR', [], NOW);
    expect(never.pending[0].reason).toBe('never');

    const outdated = evaluateBriefingRequirements(
      [PILING], 'OPERATOR', [read('1.0', '2026-09-01T09:00:00.000Z')], NOW,
    );
    expect(outdated.pending[0].reason).toBe('outdated');
  });

  it('считает ознакомление закрытым только действующей редакцией', () => {
    const result = evaluateBriefingRequirements(
      [PILING], 'OPERATOR', [read('2.0', '2026-09-01T09:00:00.000Z')], NOW,
    );
    expect(result.pending).toHaveLength(0);
  });

  /**
   * Ознакомление и повторный — разные нарушения. Человек прочитал свежую
   * редакцию год назад: ознакомлен, но повторный просрочен на девять месяцев.
   * Свести их в одно число значит потерять одно из двух.
   */
  it('видит просроченный повторный у ознакомленного работника', () => {
    const result = evaluateBriefingRequirements(
      [PILING], 'OPERATOR', [read('2.0', '2025-09-14T09:00:00.000Z')], NOW,
    );
    expect(result.pending).toHaveLength(0);
    expect(result.overdue).toHaveLength(1);
    expect(result.overdue[0].daysOverdue).toBeGreaterThan(250);
  });

  it('не считает просрочку тому, кто не проходил инструктаж ни разу', () => {
    const result = evaluateBriefingRequirements([PILING], 'OPERATOR', [], NOW);
    expect(result.overdue).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
  });

  it('не объявляет просрочку в самый день срока', () => {
    // Ровно три месяца назад: срок наступает сегодня, а не вчера.
    const result = evaluateBriefingRequirements(
      [PILING], 'OPERATOR', [read('2.0', '2026-06-14T12:00:00.000Z')], NOW,
    );
    expect(result.overdue).toHaveLength(0);
  });

  it('берёт последний инструктаж, а не первый', () => {
    const result = evaluateBriefingRequirements([PILING], 'OPERATOR', [
      read('1.0', '2025-01-10T09:00:00.000Z'),
      read('2.0', '2026-08-20T09:00:00.000Z'),
    ], NOW);
    expect(result.overdue).toHaveLength(0);
    expect(result.lastBriefingAt).toBe('2026-08-20T09:00:00.000Z');
  });

  /**
   * 30 ноября плюс три месяца — конец февраля, а не 2 марта. Иначе срок у
   * части людей молча уезжает и «просрочен» наступает позже настоящего.
   */
  it('не перепрыгивает через короткий месяц', () => {
    expect(addMonths(new Date(2025, 10, 30), 3).getMonth()).toBe(1);
    expect(addMonths(new Date(2025, 10, 30), 3).getDate()).toBe(28);
  });
});
