import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessRoleStrip, ReadinessFiltersBar, commandFailure } from '../shared';

describe('ReadinessFiltersBar: audit mode debounce and dropdown (R125 №6, №7)', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    // Фейковые таймеры включаются на время теста и снимаются после: включение
    // на уровне модуля протекало на весь файл.
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call onChange immediately for actor when typing (debounce 300ms)', () => {
    render(
      <ReadinessFiltersBar
        filters={{}}
        onChange={mockOnChange}
        mode="audit"
      />
    );

    fireEvent.change(screen.getByLabelText('Кто изменил'), { target: { value: 'test-actor' } });

    expect(mockOnChange).not.toHaveBeenCalled();

    // Advance timers by 300ms
    vi.advanceTimersByTime(300);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'test-actor' })
    );
  });

  it('calls onChange immediately for date fields (no debounce)', () => {
    render(
      <ReadinessFiltersBar
        filters={{}}
        onChange={mockOnChange}
        mode="audit"
      />
    );

    fireEvent.change(screen.getByLabelText('С даты'), { target: { value: '2026-01-15' } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-01-15' })
    );
  });

  it('renders eventType as a Select component with options', () => {
    render(
      <ReadinessFiltersBar
        filters={{}}
        onChange={mockOnChange}
        mode="audit"
      />
    );

    // The eventType field should be a Select (not an Input)
    const eventTypeLabel = screen.getByLabelText('Тип события');
    expect(eventTypeLabel).toBeInTheDocument();
    // The Select trigger should be a button with role="combobox"
    const selectTrigger = screen.getByRole('combobox', { name: 'Тип события' });
    expect(selectTrigger).toBeInTheDocument();
    // Placeholder should be visible
    expect(selectTrigger).toHaveTextContent('Все типы');
  });

  it('does not debounce status field in shifts mode', () => {
    render(
      <ReadinessFiltersBar
        filters={{}}
        onChange={mockOnChange}
        mode="shifts"
      />
    );

    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'STARTED' } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'STARTED' })
    );
  });
});
describe('commandFailure: причины отказа в допуске смены', () => {
  const failure = (status: number, body: unknown) =>
    commandFailure(new Response(JSON.stringify(body), {status}));

  it('дописывает к сообщению названия блокирующих условий из details.blockers', async () => {
    const text = await failure(422, {error: {
      message: 'Запуск смены запрещён действующими правилами готовности',
      details: {blockers: [{label: 'Нет осмотра за сегодня'}, {label: 'Критический дефект'}]},
    }});
    expect(text).toBe('Запуск смены запрещён действующими правилами готовности. Причины: Нет осмотра за сегодня; Критический дефект.');
  });

  it('принимает причины и строками (допуск оператора по документам)', async () => {
    const text = await failure(422, {error: {message: 'Оператор не допущен к работе по документам', details: {blockers: ['Просрочено удостоверение']}}});
    expect(text).toContain('Причины: Просрочено удостоверение.');
  });

  it('без details остаётся прежний текст', async () => {
    expect(await failure(422, {error: {message: 'Условие не выполнено'}})).toBe('Условие не выполнено');
  });
});

describe('ProcessRoleStrip: подсказка по нажатию на роль', () => {
  const roles = [{
    label: 'Оператор', icon: 'operator' as const, tone: 'green' as const, tasks: ['Открыть смену', 'Провести осмотр'],
    steps: [
      {title: 'Открыть смену', done: true, hint: 'Нажмите «Запросить допуск».'},
      {title: 'Провести осмотр', done: false, hint: 'Пройдите предсменный осмотр.'},
    ],
  }];

  it('по нажатию называет первый невыполненный шаг и что сделать', () => {
    render(<ProcessRoleStrip ariaLabel="Роли" roles={roles} />);
    expect(screen.queryByText('Пройдите предсменный осмотр.')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: /Оператор: что делать сейчас/}));
    expect(screen.getByText('Провести осмотр', {selector: 'strong'})).toBeTruthy();
    expect(screen.getByText('Пройдите предсменный осмотр.')).toBeTruthy();
  });

  it('роль без шагов остаётся обычной карточкой без кнопки', () => {
    render(<ProcessRoleStrip ariaLabel="Роли" roles={[{label: 'Диспетчер', icon: 'crew', tone: 'blue', tasks: ['Принять']}]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
