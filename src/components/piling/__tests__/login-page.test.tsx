import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LoginPage } from '../login-page';

// Mock external dependencies
vi.mock('@/lib/store', () => ({
  usePilingStore: vi.fn(() => ({
    login: vi.fn(),
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  motion: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));

vi.mock('lucide-react', async (importActual) => ({
  ...(await importActual<typeof import('lucide-react')>()),
  HardHat: () => <div data-testid="hardhat-icon" />,
  Mail: () => <div data-testid="mail-icon" />,
  Lock: () => <div data-testid="lock-icon" />,
  Eye: () => <div data-testid="eye-icon" />,
  EyeOff: () => <div data-testid="eye-off-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
}));

vi.mock('@/components/ui/button', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
  Label: ({ children, ...props }: any) => (
    <label {...props}>{children}</label>
  ),
}));

global.fetch = vi.fn();

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login form', () => {
    render(<LoginPage />);

    expect(screen.getByText('Piling')).toBeDefined();
    expect(screen.getByText('Track')).toBeDefined();
    expect(screen.getByLabelText('Email')).toBeDefined();
    expect(screen.getByLabelText('Пароль')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeDefined();
  });

  it('shows error when submitting empty form', async () => {
    const { toast } = await import('sonner');
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    expect(toast.error).toHaveBeenCalledWith('Заполните email и пароль');
  });

  it('submits form with valid credentials', async () => {
    const mockUser = { id: '1', email: 'test@piling.ru', name: 'Test User', role: 'OPERATOR' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: mockUser }),
    });

    const { usePilingStore } = await import('@/lib/store');
    const loginMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    (usePilingStore as any).mockImplementation(() => ({ login: loginMock }));

    render(<LoginPage />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@piling.ru' },
      });
      fireEvent.change(screen.getByLabelText('Пароль'), {
        target: { value: 'secret' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    });

    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@piling.ru', password: 'secret' }),
      });
    });
  });

  it('shows error on failed login', async () => {
    const { toast } = await import('sonner');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Неверные данные' }),
    });

    render(<LoginPage />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@piling.ru' },
      });
      fireEvent.change(screen.getByLabelText('Пароль'), {
        target: { value: 'wrong' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    });

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Неверные данные');
    });
  });

  it('toggles password visibility', () => {
    render(<LoginPage />);

    const passwordInput = screen.getByLabelText('Пароль');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleButton = screen.getByRole('button', { name: '' });
    fireEvent.click(toggleButton);

    expect(passwordInput).toHaveAttribute('type', 'text');
  });

  it('disables submit button while loading', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
    (global.fetch as any).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ user: {} }) }), 100))
    );

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'test@piling.ru' },
    });
    fireEvent.change(screen.getByLabelText('Пароль'), {
      target: { value: 'secret' },
    });

    // Click submit and immediately check that button is disabled
    const submitButton = screen.getByRole('button', { name: /Войти|loader-icon/i });
    fireEvent.click(submitButton);

    // After click, the button should be disabled (either it still says "Войти" or shows loader)
    await vi.waitFor(() => {
      const allButtons = screen.getAllByRole('button');
      const submitBtn = allButtons.find((btn) => btn.getAttribute('type') === 'submit');
      expect(submitBtn).toBeDisabled();
    });
  });
});
