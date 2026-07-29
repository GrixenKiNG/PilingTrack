import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveViewErrorBoundary } from './active-view-error-boundary';
import { BootstrapBoundary } from './bootstrap-boundary';

function BrokenView(): never {
  throw new Error('view failed');
}

function BoundaryWithRetry() {
  const retryFocusRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={retryFocusRef} type="button">Активная вкладка</button>
      <BootstrapBoundary
        state={{ status: 'error', message: 'Сервис недоступен' }}
        retryFocusRef={retryFocusRef}
        onRetry={() => undefined}
      >
        <div>Контент</div>
      </BootstrapBoundary>
    </>
  );
}

describe('readiness boundaries', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['loading', /Загрузка центра/],
    ['forbidden', /Недостаточно прав/],
    ['feature-off', /Раздел пока недоступен/],
  ] as const)('renders the %s bootstrap state', (status, heading) => {
    render(
      <BootstrapBoundary state={{ status }} >
        <div>Контент</div>
      </BootstrapBoundary>,
    );
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.queryByText('Контент')).not.toBeInTheDocument();
  });

  it('focuses the error summary and returns focus to the active tab after retry', async () => {
    render(<BoundaryWithRetry />);
    expect(screen.getByRole('heading', { name: /Не удалось загрузить/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Активная вкладка' })).toHaveFocus();
    });
  });

  it('isolates an active view render failure and can recover', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <ActiveViewErrorBoundary activeView="fleet">
        <BrokenView />
      </ActiveViewErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Раздел временно недоступен');

    rerender(
      <ActiveViewErrorBoundary activeView="shifts">
        <div>Смены восстановлены</div>
      </ActiveViewErrorBoundary>,
    );
    expect(screen.getByText('Смены восстановлены')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
