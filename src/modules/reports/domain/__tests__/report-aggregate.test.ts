/**
 * Report Aggregate — Unit Tests
 *
 * Tests the core domain logic:
 * - Business rules enforcement
 * - State transitions
 * - Event generation
 */

import { describe, it, expect } from 'vitest';
import { ReportAggregate } from '@/modules/reports/domain';

describe('ReportAggregate', () => {
  function createTestReport() {
    return ReportAggregate.create({
      reportId: 'test-1',
      userId: 'user-1',
      siteId: 'site-1',
      date: '2026-04-05',
      shiftType: 'DAY',
      shiftStart: '08:00',
      shiftEnd: '20:00',
    });
  }

  describe('creation', () => {
    it('should create report in draft status', () => {
      const report = createTestReport();
      expect(report.getState().status).toBe('draft');
    });

    it('should generate ReportCreated event', () => {
      const report = createTestReport();
      const events = report.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ReportCreated');
    });
  });

  describe('pile work', () => {
    it('should add pile work to draft report', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 10 }, 'user-1');
      expect(report.getTotalPiles()).toBe(10);
    });

    it('should reject zero pile count', () => {
      const report = createTestReport();
      expect(() =>
        report.addPileWork({ pileGradeId: 'grade-1', count: 0 }, 'user-1')
      ).toThrow('Количество свай должно быть не меньше 1');
    });

    it('should reject excessive pile count', () => {
      const report = createTestReport();
      expect(() =>
        report.addPileWork({ pileGradeId: 'grade-1', count: 10000 }, 'user-1')
      ).toThrow('Количество свай не может превышать 9999');
    });
  });

  describe('downtime', () => {
    it('should add downtime to draft report', () => {
      const report = createTestReport();
      report.addDowntime({ reasonId: 'reason-1', duration: 6 }, 'user-1');
      expect(report.getTotalDowntime()).toBe(6);
    });

    it('should reject negative downtime', () => {
      const report = createTestReport();
      expect(() =>
        report.addDowntime({ reasonId: 'reason-1', duration: -10 }, 'user-1')
      ).toThrow('Простой не может быть отрицательным');
    });

    it('should reject downtime exceeding 24h', () => {
      const report = createTestReport();
      expect(() =>
        report.addDowntime({ reasonId: 'reason-1', duration: 25 }, 'user-1')
      ).toThrow('Простой не может превышать 24 ч');
    });
  });

  describe('submit', () => {
    it('should submit report with pile work', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      report.submit('user-1', 'Test User', 'OPERATOR');
      expect(report.getState().status).toBe('submitted');
    });

    it('should submit report with drilling', () => {
      const report = createTestReport();
      report.addDrilling({ typeId: 'type-1', count: 1, metersPerUnit: 10, meters: 10 }, 'user-1');
      report.submit('user-1', 'Test User', 'OPERATOR');
      expect(report.getState().status).toBe('submitted');
    });

    it('should reject submit with no entries', () => {
      const report = createTestReport();
      expect(() => report.submit('user-1')).toThrow(
        'Отчёт должен содержать хотя бы сваи, бурение или простой'
      );
    });

    it('should submit report with only downtime (idle shift, no piles or drilling)', () => {
      const report = createTestReport();
      report.addDowntime({ reasonId: 'reason-1', duration: 11, comment: 'нет свай' }, 'user-1');
      report.submit('user-1', 'Test User', 'OPERATOR');
      expect(report.getState().status).toBe('submitted');
    });

    it('should not allow editing after submit', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      report.submit('user-1');
      expect(() =>
        report.addPileWork({ pileGradeId: 'grade-2', count: 3 }, 'user-1')
      ).toThrow('Отчёт уже сдан и не может быть изменён');
    });

    it('should generate ReportSubmitted event', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      report.submit('user-1');
      const events = report.getPendingEvents();
      expect(events.some(e => e.type === 'ReportSubmitted')).toBe(true);
    });
  });

  describe('drilling', () => {
    it('should reject negative drilling meters', () => {
      const report = createTestReport();
      expect(() =>
        report.addDrilling({ typeId: 'type-1', count: 1, metersPerUnit: 10, meters: -5 }, 'user-1')
      ).toThrow('Метры бурения не могут быть отрицательными');
    });

    it('should reject excessive drilling meters', () => {
      const report = createTestReport();
      expect(() =>
        report.addDrilling({ typeId: 'type-1', count: 1, metersPerUnit: 1, meters: 100000 }, 'user-1')
      ).toThrow('Метры бурения не могут превышать 99999');
    });
  });

  describe('event management', () => {
    it('should clear pending events after clearing', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      expect(report.getPendingEvents().length).toBeGreaterThan(0);
      report.clearPendingEvents();
      expect(report.getPendingEvents()).toHaveLength(0);
    });

    it('should increment version on each change', () => {
      const report = createTestReport();
      const initialVersion = report.getState().version;
      report.addPileWork({ pileGradeId: 'grade-1', count: 1 }, 'user-1');
      expect(report.getState().version).toBe(initialVersion + 1);
      report.addDowntime({ reasonId: 'reason-1', duration: 3 }, 'user-1');
      expect(report.getState().version).toBe(initialVersion + 2);
    });
  });

  // Проверки ниже закрывают то, чего прежние не могли поймать: они брали
  // простой в минутах (60, 30, 1441), а форма, база и служба проверки
  // работают в часах. При такой подстановке ни один заслон агрегата не
  // срабатывал — тесты были зелёными на мёртвом коде.
  describe('простой считается в часах', () => {
    it('суммарный простой больше смены — отказ', () => {
      const report = createTestReport(); // смена 08:00–20:00, то есть 12 часов
      report.addDowntime({ reasonId: 'reason-1', duration: 8 }, 'user-1');

      expect(() =>
        report.addDowntime({ reasonId: 'reason-2', duration: 5 }, 'user-1'),
      ).toThrow('Суммарный простой (13 ч) превышает продолжительность смены (12 ч)');
    });

    it('простой во всю смену — принимается', () => {
      const report = createTestReport();
      report.addDowntime({ reasonId: 'reason-1', duration: 12 }, 'user-1');

      expect(report.getTotalDowntime()).toBe(12);
    });

    it('правдоподобный простой из базы (11 ч) не отклоняется', () => {
      const report = createTestReport();
      report.addDowntime({ reasonId: 'reason-1', duration: 11 }, 'user-1');

      expect(report.getTotalDowntime()).toBe(11);
    });
  });

  // Отказ по бизнес-правилу — это ответ клиенту, а не поломка сервера.
  // Раньше агрегат бросал голый Error, обёртка не могла отличить его от
  // промаха в коде и отвечала 500 «Internal server error», попутно заводя
  // событие в Sentry на каждую обычную ошибку заполнения.
  describe('отказы агрегата несут код ответа', () => {
    it('пустой отчёт — 400, а не отказ сервера', () => {
      const report = createTestReport();

      expect(() => report.submit('user-1')).toThrowError(
        expect.objectContaining({ status: 400 }),
      );
    });

    it('правка сданного отчёта — 409', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      report.submit('user-1');

      expect(() =>
        report.addPileWork({ pileGradeId: 'grade-2', count: 3 }, 'user-1'),
      ).toThrowError(expect.objectContaining({ status: 409 }));
    });

    it('превышение простоя — 400', () => {
      const report = createTestReport();

      expect(() =>
        report.addDowntime({ reasonId: 'reason-1', duration: 25 }, 'user-1'),
      ).toThrowError(expect.objectContaining({ status: 400 }));
    });
  });
});
