import { describe, it, expect } from 'vitest';
import { computeHealthScore, findMissing, type SnapItem, type AnswerLike } from '../inspection-logic';

const items: SnapItem[] = [
  { id: 'a', answerType: 'YES_NO', required: true, photoRequired: false },
  { id: 'b', answerType: 'STATUS4', required: true, photoRequired: true },
  { id: 'c', answerType: 'STATUS4', required: false, photoRequired: false },
  { id: 'd', answerType: 'DONE', required: true, photoRequired: false },
];

describe('computeHealthScore', () => {
  it('ok = YES/OK/DONE; NA excluded from denominator', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: 'YES', photoCount: 0 },
      { itemId: 'b', result: 'OK', photoCount: 1 },
      { itemId: 'c', result: 'NA', photoCount: 0 },
      { itemId: 'd', result: 'NOT_DONE', photoCount: 0 },
    ];
    // applicable = a,b,d (c is NA) => 2 ok of 3 => 67
    expect(computeHealthScore(items, answers)).toBe(67);
  });
  it('returns 100 when all applicable are ok', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: 'YES', photoCount: 0 },
      { itemId: 'b', result: 'OK', photoCount: 1 },
      { itemId: 'd', result: 'DONE', photoCount: 0 },
    ];
    expect(computeHealthScore(items, answers)).toBe(100);
  });
  it('returns 0 when no applicable answers', () => {
    expect(computeHealthScore(items, [])).toBe(0);
  });
});

describe('findMissing', () => {
  it('flags unanswered required items and required-photo items without photos', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: '', photoCount: 0 },     // required, empty -> missing answer
      { itemId: 'b', result: 'OK', photoCount: 0 },   // photoRequired, no photo -> missing photo
      // 'd' required, no answer at all -> missing answer
    ];
    const res = findMissing(items, answers);
    expect(res.missingAnswers.sort()).toEqual(['a', 'd']);
    expect(res.missingPhotos).toEqual(['b']);
  });
  it('passes when all required answered and photos present', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: 'YES', photoCount: 0 },
      { itemId: 'b', result: 'OK', photoCount: 2 },
      { itemId: 'd', result: 'DONE', photoCount: 0 },
    ];
    const res = findMissing(items, answers);
    expect(res.missingAnswers).toEqual([]);
    expect(res.missingPhotos).toEqual([]);
  });
});
