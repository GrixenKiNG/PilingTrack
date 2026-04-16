/**
 * Retry with Exponential Backoff
 *
 * Production-grade retry utility for network calls, DB operations,
 * and external service integrations.
 *
 * Features:
 * - Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (capped)
 * - Jitter to prevent thundering herd
 * - Retry on specific error types
 * - Progress callbacks
 *
 * Usage:
 *   const result = await retryWithBackoff(
 *     () => fetch(url).then(r => r.json()),
 *     { maxRetries: 5, baseDelayMs: 1000 }
 *   );
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  retryableErrors?: Set<string>;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: true,
  retryableErrors: new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'P2024', // Prisma timeout
    'P1001', // Prisma connection error
  ]),
  onRetry: () => {},
};

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean
): number {
  // Exponential: baseDelay * 2^attempt
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const delay = Math.min(exponential, maxDelayMs);

  if (jitter) {
    // Add random jitter ±25%
    return delay * (0.75 + Math.random() * 0.5);
  }

  return delay;
}

/**
 * Check if an error is retryable.
 */
function isRetryable(error: Error, retryableErrors: Set<string>): boolean {
  // Network errors
  if (retryableErrors.has(error.message)) return true;
  if (retryableErrors.has(error.name)) return true;

  // FetchError with isRetryable flag
  if ('isRetryable' in error && (error as any).isRetryable === true) return true;

  // Prisma errors - extract code and validate type before checking
  const code = (error as any)?.code;
  if (typeof code === 'string' && retryableErrors.has(code)) return true;

  // Fetch/network errors
  if (error.message.includes('fetch') || error.message.includes('network')) return true;
  if (error.message.includes('timeout')) return true;
  if (error.message.startsWith('HTTP 5')) return true; // 5xx server errors

  return false;
}

/**
 * Execute a function with exponential backoff retry.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, jitter, retryableErrors, onRetry } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's not a retryable error
      if (!isRetryable(lastError, retryableErrors)) {
        throw lastError;
      }

      // Don't retry if we've exhausted attempts
      if (attempt === maxRetries) {
        break;
      }

      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      onRetry(attempt + 1, lastError, delayMs);

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError || new Error('Retry failed unexpectedly');
}

/**
 * Retry a fetch request with exponential backoff.
 * Convenience wrapper for common fetch retry pattern.
 */
export async function fetchWithRetry(
  url: string | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  return retryWithBackoff(
    async () => {
      const response = await fetch(url, init);
      if (!response.ok) {
        // Don't retry on 4xx errors (client errors)
        if (response.status >= 400 && response.status < 500) {
          throw new FetchError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status
          );
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    },
    options
  );
}

/**
 * Custom error for fetch failures that distinguishes
 * between client errors (4xx) and retryable server errors (5xx).
 */
export class FetchError extends Error {
  public readonly status: number;
  public readonly isRetryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.isRetryable = status >= 500;
  }
}
