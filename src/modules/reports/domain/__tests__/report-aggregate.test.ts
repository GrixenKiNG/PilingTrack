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
      ).toThrow('Pile count must be at least 1');
    });

    it('should reject excessive pile count', () => {
      const report = createTestReport();
      expect(() =>
        report.addPileWork({ pileGradeId: 'grade-1', count: 10000 }, 'user-1')
      ).toThrow('Pile count cannot exceed 9999');
    });
  });

  describe('downtime', () => {
    it('should add downtime to draft report', () => {
      const report = createTestReport();
      report.addDowntime({ reasonId: 'reason-1', duration: 60 }, 'user-1');
      expect(report.getTotalDowntime()).toBe(60);
    });

    it('should reject negative downtime', () => {
      const report = createTestReport();
      expect(() =>
        report.addDowntime({ reasonId: 'reason-1', duration: -10 }, 'user-1')
      ).toThrow('Downtime duration cannot be negative');
    });

    it('should reject downtime exceeding 24h', () => {
      const report = createTestReport();
      expect(() =>
        report.addDowntime({ reasonId: 'reason-1', duration: 1441 }, 'user-1')
      ).toThrow('Downtime cannot exceed 1440 minutes');
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
        'Report must contain at least pile work or drilling entries'
      );
    });

    it('should not allow editing after submit', () => {
      const report = createTestReport();
      report.addPileWork({ pileGradeId: 'grade-1', count: 5 }, 'user-1');
      report.submit('user-1');
      expect(() =>
        report.addPileWork({ pileGradeId: 'grade-2', count: 3 }, 'user-1')
      ).toThrow('Report is already submitted and cannot be modified');
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
      ).toThrow('Drilling meters cannot be negative');
    });

    it('should reject excessive drilling meters', () => {
      const report = createTestReport();
      expect(() =>
        report.addDrilling({ typeId: 'type-1', count: 1, metersPerUnit: 1, meters: 100000 }, 'user-1')
      ).toThrow('Drilling meters cannot exceed 99999');
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
      report.addDowntime({ reasonId: 'reason-1', duration: 30 }, 'user-1');
      expect(report.getState().version).toBe(initialVersion + 2);
    });
  });
});
