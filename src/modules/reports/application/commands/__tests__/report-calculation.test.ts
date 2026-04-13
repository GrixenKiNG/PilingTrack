/**
 * Report Calculation Service — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
  calculateReportSummary,
  calculatePeriodSummary,
  calculateDrillingVolume,
  getPileMetersPerUnit,
} from '../report-calculation.service';

describe('calculateReportSummary', () => {
  it('should sum piles, drillings, and downtimes', () => {
    const result = calculateReportSummary({
      piles: [{ count: 5 }, { count: 3 }],
      drillings: [{ meters: 10.5 }, { meters: 7.3 }],
      downtimes: [{ duration: 2 }, { duration: 1.5 }],
    });

    expect(result.totalPiles).toBe(8);
    expect(result.totalDrilling).toBe(17.8);
    expect(result.totalDowntime).toBe(3.5);
    expect(result.pileCount).toBe(2);
    expect(result.drillingCount).toBe(2);
    expect(result.downtimeCount).toBe(2);
  });

  it('should return zeros for empty arrays', () => {
    const result = calculateReportSummary({
      piles: [],
      drillings: [],
      downtimes: [],
    });

    expect(result.totalPiles).toBe(0);
    expect(result.totalDrilling).toBe(0);
    expect(result.totalDowntime).toBe(0);
    expect(result.pileCount).toBe(0);
  });

  it('should round drilling to 2 decimal places', () => {
    const result = calculateReportSummary({
      piles: [],
      drillings: [{ meters: 1.005 }, { meters: 2.005 }],
      downtimes: [],
    });

    expect(result.totalDrilling).toBe(3.01);
  });

  it('should handle single-item arrays', () => {
    const result = calculateReportSummary({
      piles: [{ count: 100 }],
      drillings: [{ meters: 50.5 }],
      downtimes: [{ duration: 0 }],
    });

    expect(result.totalPiles).toBe(100);
    expect(result.totalDrilling).toBe(50.5);
    expect(result.totalDowntime).toBe(0);
  });
});

describe('calculatePeriodSummary', () => {
  it('should aggregate across multiple reports', () => {
    const result = calculatePeriodSummary([
      {
        piles: [{ count: 10 }],
        drillings: [{ meters: 20 }],
        downtimes: [{ duration: 1 }],
      },
      {
        piles: [{ count: 5 }, { count: 3 }],
        drillings: [{ meters: 15 }],
        downtimes: [{ duration: 2 }],
      },
    ]);

    expect(result.totalPiles).toBe(18);
    expect(result.totalDrilling).toBe(35);
    expect(result.totalDowntime).toBe(3);
    expect(result.reportCount).toBe(2);
  });

  it('should return zeros for empty report list', () => {
    const result = calculatePeriodSummary([]);

    expect(result.totalPiles).toBe(0);
    expect(result.totalDrilling).toBe(0);
    expect(result.totalDowntime).toBe(0);
    expect(result.reportCount).toBe(0);
  });

  it('should handle reports with empty sub-arrays', () => {
    const result = calculatePeriodSummary([
      { piles: [], drillings: [], downtimes: [] },
      { piles: [{ count: 7 }], drillings: [], downtimes: [] },
    ]);

    expect(result.totalPiles).toBe(7);
    expect(result.reportCount).toBe(2);
  });
});

describe('calculateDrillingVolume', () => {
  it('should multiply count by metersPerUnit', () => {
    expect(calculateDrillingVolume(10, 5)).toBe(50);
  });

  it('should return 0 when count is 0', () => {
    expect(calculateDrillingVolume(0, 10)).toBe(0);
  });

  it('should return 0 when metersPerUnit is 0', () => {
    expect(calculateDrillingVolume(5, 0)).toBe(0);
  });

  it('should handle decimal values', () => {
    expect(calculateDrillingVolume(3, 2.5)).toBe(7.5);
  });
});

describe('getPileMetersPerUnit', () => {
  const grades = [
    { id: 'grade-1', name: 'Grade A' },
    { id: 'grade-2', name: 'Grade B' },
  ];

  it('should return 1 when grade exists', () => {
    expect(getPileMetersPerUnit('grade-1', grades)).toBe(1);
  });

  it('should return 0 when grade not found', () => {
    expect(getPileMetersPerUnit('grade-999', grades)).toBe(0);
  });

  it('should return 0 for empty grades list', () => {
    expect(getPileMetersPerUnit('grade-1', [])).toBe(0);
  });
});
