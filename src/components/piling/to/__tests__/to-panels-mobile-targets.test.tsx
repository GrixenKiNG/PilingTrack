/**
 * R73 №55, №56, №57 (карточка установки — панели `to/**`): на телефоне (<640px)
 * ниже 44px были «Добавить запись / показание / регламент», «Сохранить» и поля
 * форм журнала топлива, наработки и регламентов ТО (h-9 = 36px), а также
 * «Повторить» в общем блоке отказа загрузки (size="sm" = 32px). Панели стоят в
 * карточке установки ВНЕ `.tech-readiness-module`, поэтому CSS из globals.css
 * их не поднимает. Правка — только телефон: `h-11 … sm:h-9`; на десктопе (sm и
 * шире) высота прежняя (`min-height` сильнее `height`, поэтому сброс обязателен).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch, loadJson: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { FuelPanel } from '../fuel-panel';
import { MeterReadingsPanel } from '../meter-readings-panel';
import { MaintenancePlansPanel } from '../maintenance-plans-panel';
import { LoadFailure } from '../load-failure';

describe('дата ручной записи — день Москвы, а не браузера (W126 №9)', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'UTC');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T21:30:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([
    { Component: FuelPanel, add: 'Добавить запись', placeholder: 'напр. 200', path: 'fuel' },
    { Component: MeterReadingsPanel, add: 'Добавить показание', placeholder: 'напр. 5670', path: 'meter-readings' },
  ])('$path: сегодня 26.09, выбранная дата уходит прежней строкой YYYY-MM-DD', ({ Component, add, placeholder, path }) => {
    const { container } = render(<Component equipmentId="eq-1" />);
    fireEvent.click(screen.getByRole('button', { name: add }));
    const date = container.querySelector('input[type="date"]');
    if (!date) throw new Error('Не найдено поле даты');
    expect(date).toHaveValue('2026-09-26');
    fireEvent.change(date, { target: { value: '2026-09-24' } });
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(mocks.authFetch).toHaveBeenCalledWith(`/api/equipment/eq-1/${path}`, expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"recordedAt":"2026-09-24"'),
    }));
  });
});

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
    render(<LoadFailure message="Не удалось загрузить. Повторите позже (код 500)." onRetry={() => {}} />);

    // `sm:min-h-8` возвращает десктопу штатные 32px кнопки `size="sm"`.
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveClass('min-h-11', 'shrink-0', 'sm:min-h-8');
  });
});

describe('панели ТО: обрыв сети при сохранении — русский текст, а не «Failed to fetch» (F-R112-2)', () => {
  // Запрос записи уходит немедленным отказом `TypeError` («Failed to fetch»),
  // как при обрыве связи; чтение журнала на монтировании остаётся незавершённым.
  const offlineOnWrite = () => {
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? Promise.reject(new TypeError('Failed to fetch')) : new Promise(() => {}));
  };

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('журнал топлива: сохранение без связи объясняется по-русски', async () => {
    offlineOnWrite();
    render(<FuelPanel equipmentId="eq-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить запись/ }));
    fireEvent.change(screen.getByPlaceholderText('напр. 200'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет связи с сервером. Проверьте подключение и повторите.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });

  it('журнал наработки: сохранение без связи объясняется по-русски', async () => {
    offlineOnWrite();
    render(<MeterReadingsPanel equipmentId="eq-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить показание/ }));
    fireEvent.change(screen.getByPlaceholderText('напр. 5670'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет связи с сервером. Проверьте подключение и повторите.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });

  it('регламенты ТО: сохранение без связи объясняется по-русски', async () => {
    offlineOnWrite();
    render(<MaintenancePlansPanel equipmentId="eq-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить регламент/ }));
    fireEvent.change(screen.getByPlaceholderText('Напр. ТО-1 по моточасам'), { target: { value: 'ТО-1' } });
    fireEvent.change(screen.getByPlaceholderText('интервал, м/ч (напр. 250)'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Нет связи с сервером. Проверьте подключение и повторите.'),
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to fetch');
  });
});

/**
 * R135 №9: каждая панель ТО при отказе загрузки показывала и тост, и красный
 * блок `LoadFailure` с «Повторить» об одном и том же сбое. Тост убран —
 * причина и повтор остаются в блоке.
 */
describe('панели ТО: отказ загрузки не дублируется тостом (R135 №9)', () => {
  const failOnRead = () =>
    mocks.authFetch.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
        : Promise.resolve({ ok: false, status: 500, json: async () => ({}) }));

  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('журнал топлива: 500 → блок отказа без тоста', async () => {
    failOnRead();
    render(<FuelPanel equipmentId="eq-1" />);

    expect(await screen.findByText('Не удалось загрузить. Повторите позже (код 500).')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith('Не удалось загрузить журнал топлива');
  });

  it('журнал наработки: 500 → блок отказа без тоста', async () => {
    failOnRead();
    render(<MeterReadingsPanel equipmentId="eq-1" />);

    expect(await screen.findByText('Не удалось загрузить. Повторите позже (код 500).')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith('Не удалось загрузить показания');
  });

  it('регламенты ТО: 500 → блок отказа без тоста', async () => {
    failOnRead();
    render(<MaintenancePlansPanel equipmentId="eq-1" />);

    expect(await screen.findByText('Не удалось загрузить. Повторите позже (код 500).')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith('Не удалось загрузить регламенты');
  });
});

/**
 * R137 №13: переключатель «По моточасам / По календарю» в форме регламента был
 * ≈26px — палец легко попадал в соседний вариант, хотя это выбор, чем вообще
 * меряется регламент ТО. На телефоне — 44px, на десктопе высота прежняя.
 */
describe('форма регламента ТО: переключатель триггера на телефоне (R137 №13)', () => {
  it('«По моточасам»/«По календарю» — не ниже 44px, на десктопе прежняя высота', () => {
    render(<MaintenancePlansPanel equipmentId="eq-1" />);

    fireEvent.click(screen.getByRole('button', { name: /Добавить регламент/ }));

    expect(screen.getByRole('button', { name: 'По моточасам' })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-0');
    expect(screen.getByRole('button', { name: 'По календарю' })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-0');
  });
});
