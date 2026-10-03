/**
 * F-R117-1: у маршрутов группы (app) не было своего перехватчика, поэтому сбой
 * на экране уносил всю оболочку — корневой `src/app/error.tsx` рисуется вне
 * меню. Свой `(app)/error.tsx` рендерится внутри раскладки, так что меню
 * остаётся, а человек может уйти в другой раздел. Здесь зафиксированы русский
 * текст, отсутствие сырого исключения на экране, отправка в Sentry и обе
 * кнопки.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import AppErrorScreen from '../error';

describe('(app)/error — перехватчик внутри оболочки', () => {
  afterEach(() => vi.clearAllMocks());

  it('показывает русское сообщение и отправляет ошибку в Sentry', () => {
    const error = new Error('boom');
    render(<AppErrorScreen error={error} reset={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Экран не открылся' })).toBeInTheDocument();
    expect(screen.getByText(/сообщите администратору/)).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('«Повторить» вызывает reset, «На главную» ведёт на /', () => {
    const reset = vi.fn();
    render(<AppErrorScreen error={new Error('boom')} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: /Повторить/ }));
    expect(reset).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('link', { name: 'На главную' })).toHaveAttribute('href', '/');
  });
});