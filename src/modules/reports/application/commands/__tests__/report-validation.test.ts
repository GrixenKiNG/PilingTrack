/**
 * Report Validation Service — Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
}));

import {
  validateDowntimeWithinShift,
  validateReportDateNotInFuture,
  validateReportRequiredFields,
  validatePileEntries,
  validateDrillingEntries,
  validateDowntimeEntries,
  validateReportInput,
} from '../report-validation.service';

describe('Report Validation', () => {
  describe('validateReportRequiredFields', () => {
    it('should pass when all fields provided', () => {
      expect(() =>
        validateReportRequiredFields({
          reportId: 'r1',
          siteId: 's1',
          userId: 'u1',
          date: '2026-04-10',
        })
      ).not.toThrow();
    });

    it('should throw when reportId is missing', () => {
      expect(() =>
        validateReportRequiredFields({
          siteId: 's1',
          userId: 'u1',
          date: '2026-04-10',
        })
      ).toThrow('Missing required fields');
    });

    it('should throw when siteId is missing', () => {
      expect(() =>
        validateReportRequiredFields({
          reportId: 'r1',
          userId: 'u1',
          date: '2026-04-10',
        })
      ).toThrow('Missing required fields');
    });
  });

  describe('validateReportDateNotInFuture', () => {
    it('should pass for today', () => {
      const today = new Date().toISOString().split('T')[0];
      expect(() => validateReportDateNotInFuture(today)).not.toThrow();
    });

    it('should pass for past dates', () => {
      expect(() => validateReportDateNotInFuture('2020-01-01')).not.toThrow();
    });

    it('should throw for future dates', () => {
      expect(() => validateReportDateNotInFuture('2099-12-31')).toThrow(
        'Дата отчёта не может быть в будущем'
      );
    });
  });

  describe('validatePileEntries', () => {
    it('should pass with valid piles', () => {
      expect(() =>
        validatePileEntries([{ pileGradeId: 'g1', count: 10 }])
      ).not.toThrow();
    });

    it('should pass with empty array', () => {
      expect(() => validatePileEntries([])).not.toThrow();
    });

    it('should pass with undefined', () => {
      expect(() => validatePileEntries(undefined)).not.toThrow();
    });

    it('should throw when count < 1', () => {
      expect(() =>
        validatePileEntries([{ pileGradeId: 'g1', count: 0 }])
      ).toThrow('Количество свай должно быть ≥ 1');
    });

    it('should throw when count > 9999', () => {
      expect(() =>
        validatePileEntries([{ pileGradeId: 'g1', count: 10000 }])
      ).toThrow('Количество свай не может превышать 9999');
    });
  });

  describe('validateDrillingEntries', () => {
    it('should pass with valid drillings', () => {
      expect(() =>
        validateDrillingEntries([{ typeId: 't1', meters: 50, count: 2 }])
      ).not.toThrow();
    });

    it('should throw for negative meters', () => {
      expect(() =>
        validateDrillingEntries([{ typeId: 't1', meters: -1 }])
      ).toThrow('Метраж бурения не может быть отрицательным');
    });

    it('should throw for meters > 99999', () => {
      expect(() =>
        validateDrillingEntries([{ typeId: 't1', meters: 100000 }])
      ).toThrow('Метраж бурения не может превышать 99999');
    });

    it('should throw for count < 1', () => {
      expect(() =>
        validateDrillingEntries([{ typeId: 't1', meters: 10, count: 0 }])
      ).toThrow('Количество бурений должно быть ≥ 1');
    });
  });

  describe('validateDowntimeEntries', () => {
    it('should pass with valid downtimes', () => {
      expect(() =>
        validateDowntimeEntries([{ reasonId: 'r1', duration: 60 }])
      ).not.toThrow();
    });

    it('should throw for negative duration', () => {
      expect(() =>
        validateDowntimeEntries([{ reasonId: 'r1', duration: -1 }])
      ).toThrow('Длительность простоя не может быть отрицательной');
    });

    it('should throw for duration > 1440', () => {
      expect(() =>
        validateDowntimeEntries([{ reasonId: 'r1', duration: 1441 }])
      ).toThrow('Длительность простоя не может превышать 1440');
    });
  });

  describe('validateDowntimeWithinShift', () => {
    it('should pass when downtime fits within day shift', () => {
      // 08:00 - 20:00 = 12 hours shift
      expect(() =>
        validateDowntimeWithinShift('08:00', '20:00', [{ duration: 10 }])
      ).not.toThrow();
    });

    it('should throw when downtime exceeds shift', () => {
      // 08:00 - 20:00 = 12 hours shift, but 15h downtime
      expect(() =>
        validateDowntimeWithinShift('08:00', '20:00', [{ duration: 15 }])
      ).toThrow('Суммарный простой');
    });

    it('should handle overnight shift correctly', () => {
      // 20:00 - 08:00 = 12 hours (overnight)
      expect(() =>
        validateDowntimeWithinShift('20:00', '08:00', [{ duration: 10 }])
      ).not.toThrow();
    });

    it('should throw when downtime exceeds overnight shift', () => {
      // 20:00 - 08:00 = 12 hours, but 13h downtime
      expect(() =>
        validateDowntimeWithinShift('20:00', '08:00', [{ duration: 13 }])
      ).toThrow('Суммарный простой');
    });

    it('should skip when shiftStart is null', () => {
      expect(() =>
        validateDowntimeWithinShift(null, '20:00', [{ duration: 100 }])
      ).not.toThrow();
    });

    it('should skip when shiftEnd is null', () => {
      expect(() =>
        validateDowntimeWithinShift('08:00', null, [{ duration: 100 }])
      ).not.toThrow();
    });

    it('should sum multiple downtimes', () => {
      // 08:00 - 20:00 = 12 hours, downtimes: 6 + 7 = 13h > 12h
      expect(() =>
        validateDowntimeWithinShift('08:00', '20:00', [
          { duration: 6 },
          { duration: 7 },
        ])
      ).toThrow('Суммарный простой');
    });
  });

  describe('validateReportInput', () => {
    it('should pass with complete valid input', () => {
      const today = new Date().toISOString().split('T')[0];
      expect(() =>
        validateReportInput({
          reportId: 'r1',
          siteId: 's1',
          userId: 'u1',
          date: today,
          shiftStart: '08:00',
          shiftEnd: '20:00',
          piles: [{ pileGradeId: 'g1', count: 5 }],
          drillings: [{ typeId: 't1', meters: 100 }],
          downtimes: [{ reasonId: 'r1', duration: 2 }],
        })
      ).not.toThrow();
    });

    it('should throw for missing required fields', () => {
      expect(() => validateReportInput({})).toThrow('Missing required fields');
    });
  });
});
