import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger, withRequestLogging } from '../logger';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('X9: structured log redaction', () => {
  it('redacts sensitive keys recursively without mutating data or ordinary fields', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('LOG_LEVEL', 'debug');
    const data = { requestId: 'req-1', durationMs: 0, tokenCount: 42, ok: true, missing: null,
      nested: [{ PASSWORD: 'password-value', accessToken: 'access-value', refresh_token: 'refresh-value', authorization: 'Bearer value', 'set-cookie': 'session=value', clientSecret: 'secret-value', secretAccessKey: 'key-value', initData: 'telegram-value', phoneNumber: '+79990000000', operatorEmail: 'private@example.invalid', count: 3 }],
    };
    logger.info('event', data);
    const line = String(output.mock.calls[0][0]);
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({ level: 'info', message: 'event', requestId: 'req-1', durationMs: 0, tokenCount: 42, ok: true, missing: null });
    expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
    for (const [key, value] of Object.entries(data.nested[0])) {
      expect(entry.nested[0][key]).toBe(key === 'count' ? value : '[REDACTED]');
      if (key !== 'count') expect(line).not.toContain(String(value));
    }
    expect(data.nested[0].PASSWORD).toBe('password-value');
  });

  it('applies to debug, warn and error while keeping error diagnostics', () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    const debug = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.debug('debug', { token: 'debug-secret' });
    logger.warn('warn', { cookie: 'warn-secret' });
    logger.error('error', new Error('ordinary failure'), { password: 'error-secret' });
    expect(JSON.parse(String(debug.mock.calls[0][0])).token).toBe('[REDACTED]');
    expect(JSON.parse(String(warn.mock.calls[0][0])).cookie).toBe('[REDACTED]');
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ password: '[REDACTED]', error: 'ordinary failure', stack: expect.stringContaining('ordinary failure') });
  });

  it('preserves filtering, timed request metadata and return values', async () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('filtered', { token: 'hidden' });
    expect(output).not.toHaveBeenCalled();
    vi.stubEnv('LOG_LEVEL', 'info');
    const result = await withRequestLogging(async () => 42, { method: 'GET', path: '/reports', requestId: 'req-2', userId: 'user-1' });
    expect(result).toBe(42);
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ message: 'GET /reports', requestId: 'req-2', userId: 'user-1', durationMs: expect.any(Number) });
  });
});
