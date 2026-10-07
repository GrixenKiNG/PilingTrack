import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadinessFiltersBar } from '../shared';

vi.useFakeTimers();

describe('ReadinessFiltersBar: audit mode debounce and dropdown (R125 №6, №7)', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  it('does not call onChange immediately for actor when typing (debounce 300ms)', () => {
    render(
      <ReadinessFiltersBar
        filters={{}}
        onChange={mockOnChange}
        mode="audit"
      />
    );

    fireEvent.change(screen.getByLabelText('Актор'), { target: { value: 'test-actor' } });

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

  it('debounces actor field (300ms)', () => {
    render(
      <ReadinessFiltersBar
        filters={{}}
        onChange={mockOnChange}
        mode="audit"
      />
    );

    fireEvent.change(screen.getByLabelText('Актор'), { target: { value: 'actor-1' } });
    expect(mockOnChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(mockOnChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150); // total 300ms
    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'actor-1' })
    );
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