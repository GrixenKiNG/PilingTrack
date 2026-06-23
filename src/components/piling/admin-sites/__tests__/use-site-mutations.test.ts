/**
 * extractApiError — surfaces the server's error message (finding #3).
 *
 * Deactivating a site with unfinished draft reports returns a 409 with a
 * helpful Russian message. The handlers must show it instead of a generic
 * "Ошибка".
 */

import { describe, it, expect } from 'vitest';
import { extractApiError } from '../use-site-mutations';

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
