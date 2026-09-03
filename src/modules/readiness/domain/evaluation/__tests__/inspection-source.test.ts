import {describe, expect, it} from 'vitest';
import {chooseInspectionSource} from '../inspection-source';

const morning = new Date('2026-09-02T04:00:00.000Z');
const afternoon = new Date('2026-09-02T11:00:00.000Z');
const lastWeek = new Date('2026-08-26T09:00:00.000Z');

describe('выбор осмотра для оценки состояния', () => {
  it('берёт осмотр механика, если он закрыт позже утреннего обхода машиниста', () => {
    // Тот самый случай, ради которого правило и появилось: механик разобрал
    // узел днём, а готовность считалась по состоянию машины до ремонта.
    expect(chooseInspectionSource({
      operatorAt: morning, operatorSameDay: true, mechanicAt: afternoon,
    })).toBe('INSPECTION');
  });

  it('берёт осмотр машиниста, если журнал механика старше', () => {
    expect(chooseInspectionSource({
      operatorAt: morning, operatorSameDay: true, mechanicAt: lastWeek,
    })).toBe('OPERATOR_CHECKLIST');
  });

  it('берёт осмотр машиниста, когда журнала механика нет вовсе', () => {
    expect(chooseInspectionSource({
      operatorAt: morning, operatorSameDay: true, mechanicAt: null,
    })).toBe('OPERATOR_CHECKLIST');
  });

  it('не берёт вчерашний осмотр машиниста', () => {
    // Вчерашний чек-лист ничего не говорит о машине сегодня. Журнал механика
    // живёт дольше суток: ремонт недельной давности остаётся фактом.
    expect(chooseInspectionSource({
      operatorAt: morning, operatorSameDay: false, mechanicAt: lastWeek,
    })).toBe('INSPECTION');
  });

  it('ничего не выбирает, когда нет ни свежего чек-листа, ни журнала', () => {
    expect(chooseInspectionSource({
      operatorAt: morning, operatorSameDay: false, mechanicAt: null,
    })).toBeNull();
    expect(chooseInspectionSource({
      operatorAt: null, operatorSameDay: true, mechanicAt: null,
    })).toBeNull();
  });
});
