/**
 * R73 №55, №56, №57 (карточка установки — панели `to/**`): на телефоне (<640px)
 * ниже 44px были «Добавить запись / показание / регламент», «Сохранить» и поля
 * форм журнала топлива, наработки и регламентов ТО (h-9 = 36px), а также
 * «Повторить» в общем блоке отказа загрузки (size="sm" = 32px). Панели стоят в
 * карточке установки ВНЕ `.tech-readiness-module`, поэтому CSS из globals.css
 * их не поднимает. Правка — только телефон: `h-11 … sm:h-9`; на десктопе (sm и
 * шире) высота прежняя (`min-height` сильнее `height`, поэтому сброс обязателен).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch, loadJson: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { FuelPanel } from '../fuel-panel';
import { MeterReadingsPanel } from '../meter-readings-panel';
import { MaintenancePlansPanel } from '../maintenance-plans-panel';
import { LoadFailure } from '../load-failure';

beforeEach(() => {
  mocks.authFetch.mockReset();
  // Ответ не нужен: проверяем разметку целей нажатия, а не загрузку журнала
  // (незавершённый запрос заодно не будит setState после теста).
  mocks.authFetch.mockImplementation(() => new Promise(() => {}));
});

describe('журнал топлива: цели нажатия на телефоне (R73 №55)', () => {
  it('кнопки, поля формы и дата — не ниже 44px, на десктопе прежние 36px', () => {
    const { container } = render(<FuelPanel equipmentId="eq-1" />);

    const add = screen.getByRole('button', { name: /Добавить запись/ });
    expect(add).toHaveClass('h-11', 'w-full', 'sm:h-9');
    // Шрифт на телефоне не уменьшаем: размер текста прежний.
    expect(add).toHaveClass('text-sm');

    fireEvent.click(add);

    for (const placeholder of ['напр. 200', 'напр. 40', 'необязательно']) {
      expect(screen.getByPlaceholderText(placeholder)).toHaveClass('h-11', 'sm:h-9');
    }
    expect(container.querySelector('input[type="date"]')).toHaveClass('h-11', 'sm:h-9');
    expect(screen.getByRole('button', { name: /Сохранить/ })).toHaveClass('h-11', 'w-full', 'sm:h-9');
  });
});

describe('журнал наработки: цели нажатия на телефоне (R73 №56)', () => {
  it('кнопки и поля формы — не ниже 44px, на десктопе прежние 36px', () => {
    const { container } = render(<MeterReadingsPanel equipmentId="eq-1" />);

    const add = screen.getByRole('button', { name: /Добавить показание/ });
    expect(add).toHaveClass('h-11', 'w-full', 'sm:h-9');

    fireEvent.click(add);

    expect(screen.getByPlaceholderText('напр. 5670')).toHaveClass('h-11', 'sm:h-9');
    expect(screen.getByPlaceholderText('необязательно')).toHaveClass('h-11', 'sm:h-9');
    expect(container.querySelector('input[type="date"]')).toHaveClass('h-11', 'sm:h-9');
    expect(screen.getByRole('button', { name: /Сохранить/ })).toHaveClass('h-11', 'w-full', 'sm:h-9');
  });
});

describe('регламенты ТО: цели нажатия на телефоне (R73 №56)', () => {
  it('кнопки и поля формы — не ниже 44px, на десктопе прежние 36px', () => {
    render(<MaintenancePlansPanel equipmentId="eq-1" />);

    const add = screen.getByRole('button', { name: /Добавить регламент/ });
    expect(add).toHaveClass('h-11', 'w-full', 'sm:h-9');

    fireEvent.click(add);

    expect(screen.getByPlaceholderText('Напр. ТО-1 по моточасам')).toHaveClass('h-11', 'sm:h-9');
    expect(screen.getByPlaceholderText('интервал, м/ч (напр. 250)')).toHaveClass('h-11', 'sm:h-9');
    expect(screen.getByRole('button', { name: /Сохранить/ })).toHaveClass('h-11', 'w-full', 'sm:h-9');
  });
});

describe('блок отказа загрузки: цель нажатия на телефоне (R73 №57)', () => {
  it('«Повторить» — не ниже 44px, на десктопе прежние 32px', () => {
    render(<LoadFailure message="Не удалось загрузить: сервер вернул 500" onRetry={() => {}} />);

    // `sm:min-h-8` возвращает десктопу штатные 32px кнопки `size="sm"`.
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveClass('min-h-11', 'shrink-0', 'sm:min-h-8');
  });
});
