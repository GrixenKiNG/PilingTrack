import {describe, expect, it} from 'vitest';
import {buildReadinessCsv, safeCsvCell} from '../csv-export';

describe('readiness CSV export', () => {
  it.each(['=SUM(A1:A2)', '+cmd', '-1+2', '@value', '\tformula', '   =HYPERLINK("https://example.invalid")'])(
    'neutralizes spreadsheet formulas: %s',
    (value) => expect(safeCsvCell(value)).toContain("'"),
  );

  it('does not quote plain numbers, so negative columns still sum in Excel', () => {
    expect(safeCsvCell('-5')).toBe('"-5"');
    expect(safeCsvCell('1,5')).toBe('"1,5"');
    expect(safeCsvCell('-5+A1')).toBe(`"'-5+A1"`);
  });

  it('embeds timezone and deterministic data hash', () => {
    const result = buildReadinessCsv({
      dataset: 'audit',
      timezone: 'Europe/Moscow',
      generatedAt: new Date('2026-08-02T08:00:00.000Z'),
      filters: {status: 'APPROVED'},
      rows: [['id', 'value'], ['1', '=danger']],
    });
    expect(result.body).toContain('Europe/Moscow');
    expect(result.body).toContain(result.hash);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.body).toContain("'=danger");
  });

  it('prints instants as ДД.ММ.ГГГГ ЧЧ:ММ in the tenant timezone', () => {
    expect(safeCsvCell(new Date('2026-09-25T21:30:00.000Z'), 'Europe/Moscow')).toBe('"26.09.2026 00:30"');
    expect(safeCsvCell('2026-09-25T21:30:00.000Z', 'Europe/Moscow')).toBe('"26.09.2026 00:30"');
  });

  it('keeps plain production days unshifted', () => {
    expect(safeCsvCell('2026-09-25', 'America/New_York')).toBe('"25.09.2026"');
  });

  it('applies the export timezone to data rows', () => {
    const result = buildReadinessCsv({
      dataset: 'reports',
      timezone: 'Asia/Vladivostok',
      generatedAt: new Date('2026-08-02T08:00:00.000Z'),
      filters: {},
      rows: [['Дата'], ['2026-09-25T21:30:00.000Z']],
    });
    expect(result.body).toContain('"26.09.2026 07:30"');
  });
});
