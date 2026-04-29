/**
 * filterPileGradesBySitePlan — UI dropdown regression test.
 *
 * Operators should only see grades present in the selected site's plan,
 * otherwise they'll pick a grade the API later rejects. Sites with no
 * plan (legacy) keep the full catalogue.
 */
import { describe, it, expect } from 'vitest';
import { filterPileGradesBySitePlan } from '../filter-pile-grades';

describe('filterPileGradesBySitePlan', () => {
  const grades = [
    { id: 'pg_1', name: 'A' },
    { id: 'pg_2', name: 'B' },
    { id: 'pg_3', name: 'C' },
  ];

  it('returns only grades present in the site plan', () => {
    const plans = [{ pileGradeId: 'pg_1' }, { pileGradeId: 'pg_3' }];
    const result = filterPileGradesBySitePlan(grades, plans);
    expect(result.map((g) => g.id)).toEqual(['pg_1', 'pg_3']);
  });

  it('returns full list when site has no plan (undefined)', () => {
    expect(filterPileGradesBySitePlan(grades, undefined)).toEqual(grades);
  });

  it('returns full list when site has no plan (null)', () => {
    expect(filterPileGradesBySitePlan(grades, null)).toEqual(grades);
  });

  it('returns full list when plan is an empty array (legacy site)', () => {
    expect(filterPileGradesBySitePlan(grades, [])).toEqual(grades);
  });

  it('returns empty array when plan references unknown grades only', () => {
    expect(filterPileGradesBySitePlan(grades, [{ pileGradeId: 'pg_unknown' }])).toEqual([]);
  });
});
