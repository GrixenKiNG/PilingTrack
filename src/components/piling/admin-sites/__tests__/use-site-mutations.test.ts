/**
 * extractApiError — surfaces the server's error message (finding #3).
 *
 * Deactivating a site with unfinished draft reports returns a 409 with a
 * helpful Russian message. The handlers must show it instead of a generic
 * "Ошибка".
 */

import { describe, it, expect } from 'vitest';
import { extractApiError } from '../use-site-mutations';
import { deactivateDescription } from '../site-deactivate';

function res(json: () => Promise<unknown>): Response {
  return { json } as unknown as Response;
}

describe('extractApiError', () => {
  it('returns the server error field when present', async () => {
    const message = await extractApiError(
      res(async () => ({ error: 'Невозможно деактивировать объект: 2 незавершённых отчётов.' })),
      'fallback',
    );
    expect(message).toBe('Невозможно деактивировать объект: 2 незавершённых отчётов.');
  });

  it('returns the fallback when the body has no error field', async () => {
    const message = await extractApiError(res(async () => ({ ok: false })), 'fallback');
    expect(message).toBe('fallback');
  });

  it('returns the fallback when the body is not JSON', async () => {
    const message = await extractApiError(res(async () => { throw new Error('not json'); }), 'fallback');
    expect(message).toBe('fallback');
  });
});

describe('deactivateDescription — окно «Деактивировать объект?»', () => {
  it('называет бригады и установки на объекте', () => {
    expect(deactivateDescription({ crewCount: 2, rigNames: ['Banut 655', 'КБУРГ-16.02 №1'] }))
      .toContain('Сейчас на объекте 2 бригады (установки: Banut 655, КБУРГ-16.02 №1).');
  });

  it('не утверждает «бригад нет», если бригады не загрузились', () => {
    const text = deactivateDescription({ crewCount: null, rigNames: [] });
    expect(text).toContain('не загрузились');
    expect(text).not.toContain('Бригад на объекте нет');
  });
});
