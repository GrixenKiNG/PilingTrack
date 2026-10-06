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
import { render, screen } from '@testing-library/react';
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

function BrokenPage(): never {
  throw new Error('page failed');
}

describe('(app)/layout — граница оболочки не перехватывает страницу', () => {
  beforeEach(() => {
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
});