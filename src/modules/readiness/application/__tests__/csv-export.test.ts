import {describe, expect, it} from 'vitest';
import {buildReadinessCsv, safeCsvCell} from '../csv-export';

describe('readiness CSV export', () => {
  it.each(['=SUM(A1:A2)', '+cmd', '-1+2', '@value', '\tformula', '   =HYPERLINK("https://example.invalid")'])(
    'neutralizes spreadsheet formulas: %s',
    (value) => expect(safeCsvCell(value)).toContain("'"),
  );

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
});
