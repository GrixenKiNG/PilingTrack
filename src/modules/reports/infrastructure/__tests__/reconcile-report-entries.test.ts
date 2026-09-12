import { describe, expect, it } from 'vitest';
import { reconcileReportEntries } from '../reconcile-report-entries';

const fields = ['pileGradeId', 'count', 'picketId'];
const group = ['pileGradeId', 'picketId'];
const passport = { id: 'passport', refusalSetBlows: 10 };
const rows = [
  { id: 'signed', pileGradeId: 'grade', count: 1, picketId: null, passport },
  { id: 'batch', pileGradeId: 'grade', count: 4, picketId: null },
];

describe('report work identity and passport protection', () => {
  it('preserves signed work when an old client reorders rows and changes a batch', () => {
    const result = reconcileReportEntries(rows, [
      { pileGradeId: 'grade', count: 5 },
      { pileGradeId: 'grade', count: 1 },
    ], fields, group);
    expect(result.removeIds).toEqual([]);
    expect(result.rows.map(row => row.id)).toEqual(['batch', 'signed']);
  });

  it('rejects removal or mutation of a passport-bearing pile', () => {
    expect(() => reconcileReportEntries(rows, [rows[1]], fields, group)).toThrow('паспортом');
    expect(() => reconcileReportEntries(rows, [{ ...rows[0], count: 2 }, rows[1]], fields, group)).toThrow('паспорт');
  });

  it('rejects foreign and duplicate row IDs', () => {
    expect(() => reconcileReportEntries(rows, [{ ...rows[0], id: 'foreign' }], fields, group)).toThrow('отсутствует');
    expect(() => reconcileReportEntries(rows, [rows[0], rows[0]], fields, group)).toThrow('повторно');
  });

  it('reserves explicit IDs before matching legacy rows and adds only new work', () => {
    const result = reconcileReportEntries(rows, [
      { pileGradeId: 'new-grade', count: 2 }, rows[0], rows[1],
    ], fields, group);
    expect(result.removeIds).toEqual([]);
    expect(result.rows.map(row => row.id)).toEqual([undefined, 'signed', 'batch']);
  });

  it('removes only explicitly omitted unprotected work', () => {
    const result = reconcileReportEntries(rows, [rows[0]], fields, group);
    expect(result.removeIds).toEqual(['batch']);
    expect(result.rows[0].data).toEqual({ pileGradeId: 'grade', count: 1, picketId: null });
  });
});
