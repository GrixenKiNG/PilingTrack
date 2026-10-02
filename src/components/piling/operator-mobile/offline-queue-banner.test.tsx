import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePilingStore} from '@/lib/store';
import {enqueue} from './offline-queue';
import {OfflineQueueBanner} from './offline-queue-banner';

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  });
});

describe('плашка очереди на общем телефоне', () => {
  it('сменщику видно, что записи прежнего машиниста не отправлены (R43 №2)', () => {
    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    enqueue({command: 'log-production', clientCommandId: 'c1', entry: {kind: 'PILES'}} as never);
    usePilingStore.setState({currentUser: {id: 'op-night', name: 'Петров П.'} as never});

    render(<OfflineQueueBanner items={[]} onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('другого сотрудника (Иванов И.): 1');
    usePilingStore.setState({currentUser: null});
  });

  it('у отвергнутой записи основное действие — удаление, а повтор второстепенный (R76 №15)', () => {
    usePilingStore.setState({currentUser: {id: 'op-day', name: 'Иванов И.'} as never});
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    // Запись лежит в очереди целиком и не редактируется: повтор отправит то же самое.
    const item = {
      clientCommandId: 'f1',
      label: 'Выработка',
      command: {command: 'log-production', entry: {kind: 'PILES', count: 12}},
      queuedAt: '2026-10-01T08:00:00.000Z',
      attempts: 2,
      state: 'FAILED' as const,
      lastError: 'Число не изменилось',
    };

    render(<OfflineQueueBanner items={[item]} onRetry={onRetry} onDiscard={onDiscard} />);

    // Текст отказа сервера — крупнее остального и показан как главное.
    const reason = screen.getByText('Число не изменилось');
    expect(reason.className).toContain('text-sm');
    expect(reason.className).toContain('font-semibold');

    // Основное действие — удаление записи (заливка), повтор — второстепенная кнопка с пояснением.
    expect(screen.getByRole('button', {name: 'Удалить запись'}).className).toContain('bg-destructive');
    expect(screen.getByText(/Повтор отправит то же самое/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', {name: 'Повторить'}));
    expect(onRetry).toHaveBeenCalledWith('f1');

    fireEvent.click(screen.getByRole('button', {name: 'Удалить запись'}));
    expect(screen.getByText(/Введено/).textContent).toContain('сваи: 12 шт');
    fireEvent.click(screen.getByRole('button', {name: 'Да, убрать'}));
    expect(onDiscard).toHaveBeenCalledWith('f1');
    usePilingStore.setState({currentUser: null});
  });
});

describe('плашка ждущих записей: связь или отказ сервера', () => {
  const pending = (lastError: string | null) => ({
    clientCommandId: 'p1',
    label: 'Выработка',
    command: {command: 'log-production', entry: {kind: 'PILES', count: 12}},
    queuedAt: '2026-10-01T08:00:00.000Z',
    attempts: 1,
    state: 'PENDING' as const,
    lastError,
  });

  it('PENDING после обрыва связи → «Отправим, когда появится связь»', () => {
    // Обрыв сети приходит англоязычным текстом браузера (см. api.ts sendCommand).
    render(<OfflineQueueBanner items={[pending('Failed to fetch')]} onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('Отправим, когда появится связь.');
  });

  it('PENDING с отказом сервера (503) → «Сервер не принял…» и причина видна', () => {
    const reason = 'Сервис временно недоступен. Попробуйте позже.';
    render(<OfflineQueueBanner items={[pending(reason)]} onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toContain('Сервер не принял запись, повторим автоматически.');
    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('английский текст сети не показывается как причина отказа сервера', () => {
    render(<OfflineQueueBanner items={[pending('Failed to fetch')]} onRetry={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.queryByText('Failed to fetch')).toBeNull();
  });

  it('одинаковые причины ждущих записей сворачиваются с «(×N)» (F-V1-BANNER-DEDUPE)', () => {
    const reason = 'Сервер временно недоступен (код 503).';
    const other = 'Смена уже закрыта';
    render(
      <OfflineQueueBanner
        items={[
          {...pending(reason), clientCommandId: 'p1'},
          {...pending(reason), clientCommandId: 'p2'},
          {...pending(reason), clientCommandId: 'p3'},
          {...pending(other), clientCommandId: 'p4'},
        ]}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );

    const text = screen.getByRole('status').textContent ?? '';
    // Первая причина — один раз, со счётчиком записей.
    expect(text).toContain(`${reason} (×3)`);
    expect(text.match(/код 503/g)).toHaveLength(1);
    // Вторая причина уникальна — без счётчика и тоже один раз.
    expect(text).toContain(other);
    expect(text.match(/Смена уже закрыта/g)).toHaveLength(1);
  });
});

describe('причина отказа не повторяется в карточке (F-R89-DUP-REJECT)', () => {
  const failed = (lastError: string) => ({
    clientCommandId: 'f1',
    label: 'Выработка',
    command: {command: 'log-production', entry: {kind: 'PILES', count: 12}},
    queuedAt: '2026-10-01T08:00:00.000Z',
    attempts: 1,
    state: 'FAILED' as const,
    lastError,
  });

  it('причина, показанная у кнопки экрана, в карточке не печатается, кнопки остаются', () => {
    const reason = 'Паспорт заполнен не полностью';
    render(
      <OfflineQueueBanner
        items={[failed(reason)]}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
        shownElsewhere={reason}
      />,
    );

    expect(screen.queryByText(reason)).toBeNull();
    // Состав и кнопки карточки на месте — запись можно разобрать.
    expect(screen.getByRole('button', {name: 'Удалить запись'})).toBeTruthy();
    expect(screen.getByRole('button', {name: 'Повторить'})).toBeTruthy();
  });

  it('другая причина у кнопки — причина карточки видна как раньше', () => {
    const reason = 'Паспорт заполнен не полностью';
    render(
      <OfflineQueueBanner
        items={[failed(reason)]}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
        shownElsewhere="Смена уже закрыта"
      />,
    );

    expect(screen.getByText(reason)).toBeTruthy();
  });

  it('пустой shownElsewhere — причина карточки видна как раньше', () => {
    const reason = 'Паспорт заполнен не полностью';
    render(
      <OfflineQueueBanner items={[failed(reason)]} onRetry={vi.fn()} onDiscard={vi.fn()} />,
    );

    expect(screen.getByText(reason)).toBeTruthy();
  });
});
