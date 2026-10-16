/**
 * F-R117-2: полноэкранная граница оболочки (`AppErrorBoundary`) была обёрнута
 * вокруг раскладки целиком, поэтому падение страницы перехватывалось ею
 * раньше, чем маршрутным `(app)/error.tsx`, — и «Произошла ошибка» подменяло
 * всю оболочку вместе с меню. Здесь зафиксировано: ошибка страницы уходит
 * наружу, к маршрутной границе, а оболочка по-прежнему рисуется.
 *
 * Тест воспроизводит разметку Next: `children` раскладки — это слот, в котором
 * живёт страница, а `AppErrorBoundary` — ближайшая к ней граница, если она её
 * оборачивает.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from 'react-error-boundary';
import { usePilingStore } from '@/lib/store';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// Объект роутера стабилен между рендерами: раскладка держит его в зависимостях
// эффекта, а новый объект на каждый рендер зациклил бы проверку сессии.
const { routerMock } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin',
  useRouter: () => routerMock,
}));

vi.mock('@/lib/api', () => ({
  probeSession: vi.fn(async () => ({
    status: 'authenticated',
    user: { id: 'u1', email: 'admin@example.com', name: 'Админ', role: 'ADMIN' },
  })),
  logoutClient: vi.fn(),
}));

// Оболочка тянет за собой опрос обратной связи и полосу «Действую как» — они не
// предмет этого теста, поэтому заглушены.
vi.mock('@/components/piling/feedback-center', () => ({ FeedbackCenter: () => null }));
vi.mock('@/components/piling/acting-as-banner', () => ({ ActingAsBanner: () => null }));

vi.mock('framer-motion', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  AnimatePresence: ({ children }: any) => <>{children}</>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  MotionConfig: ({ children }: any) => <>{children}</>,
}));

import AppLayout from '../layout';
import { probeSession } from '@/lib/api';

function BrokenPage(): never {
  throw new Error('page failed');
}

describe('(app)/layout — граница оболочки не перехватывает страницу', () => {
  beforeEach(() => {
    routerMock.replace.mockClear();
    vi.mocked(probeSession).mockReset().mockResolvedValue({
      status: 'authenticated',
      user: { id: 'u1', email: 'admin@example.com', name: 'Админ', role: 'ADMIN' },
    });
    usePilingStore.setState({
      currentUser: { id: 'u1', email: 'admin@example.com', name: 'Админ', role: 'ADMIN' },
    });
  });

  it('ошибка страницы уходит к маршрутной границе, а не в полноэкранный запасной экран', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(
        <ErrorBoundary fallbackRender={() => <div>route-error</div>}>
          <AppLayout>
            <BrokenPage />
          </AppLayout>
        </ErrorBoundary>,
      );

      expect(await screen.findByText('route-error')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Произошла ошибка' })).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('оболочка рисуется вместе со страницей', async () => {
    render(
      <AppLayout>
        <div>страница</div>
      </AppLayout>,
    );

    expect(await screen.findByText('страница')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });

  it('при сбое сохраняет пользователя, показывает повтор и возвращает страницу после восстановления', async () => {
    vi.mocked(probeSession).mockResolvedValueOnce({ status: 'unknown' });
    render(<AppLayout><div>страница</div></AppLayout>);

    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(usePilingStore.getState().currentUser?.id).toBe('u1');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('страница')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('страница')).toBeInTheDocument();
    expect(probeSession).toHaveBeenCalledTimes(2);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('при неизвестной сессии без локального пользователя остаётся на повторе вместо входа', async () => {
    usePilingStore.setState({ currentUser: null });
    vi.mocked(probeSession).mockResolvedValueOnce({ status: 'unknown' });
    render(<AppLayout><div>страница</div></AppLayout>);

    expect(await screen.findByText('Нет связи')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('после повтора явная отсутствующая сессия очищает пользователя и открывает вход', async () => {
    vi.mocked(probeSession)
      .mockResolvedValueOnce({ status: 'unknown' })
      .mockResolvedValueOnce({ status: 'anonymous' });
    render(<AppLayout><div>страница</div></AppLayout>);

    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/login'));
    expect(usePilingStore.getState().currentUser).toBeNull();
    expect(screen.queryByText('страница')).not.toBeInTheDocument();
  });
});
