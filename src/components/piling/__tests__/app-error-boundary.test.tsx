import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { AppErrorBoundary } from '../app-error-boundary';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

function BrokenScreen(): never {
  throw new Error('screen failed');
}

describe('AppErrorBoundary', () => {
  afterEach(() => vi.clearAllMocks());

  it('reports a screen failure to Sentry once', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary>
        <BrokenScreen />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Произошла ошибка' })).toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [error, options] = vi.mocked(Sentry.captureException).mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('screen failed');
    expect(options).toMatchObject({ extra: { componentStack: expect.any(String) } });
    consoleError.mockRestore();
  });
});
