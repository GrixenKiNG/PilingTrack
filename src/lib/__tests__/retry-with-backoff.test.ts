/**
 * Unit Tests — Retry with Exponential Backoff
 *
 * Tests the core retry logic, delay calculation, jitter, and error handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff, FetchError } from '@/lib/retry-with-backoff';

describe('retryWithBackoff', () => {
  it('succeeds on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('success');

    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after maxRetries exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })
    ).rejects.toThrow('ECONNRESET');

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Validation failed'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 })
    ).rejects.toThrow('Validation failed');

    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it('calls onRetry callback with correct parameters', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue('ok');

    await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.any(Number), // attempt
      expect.any(Error), // error
      expect.any(Number), // delayMs
    );
  });

  it('FetchError 4xx is not retryable', async () => {
    const fn = vi.fn().mockRejectedValue(new FetchError('HTTP 404: Not Found', 404));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 })
    ).rejects.toThrow('HTTP 404');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('FetchError 5xx is retryable', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new FetchError('HTTP 502: Bad Gateway', 502))
      .mockResolvedValue('ok');

    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
