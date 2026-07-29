import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRegion } from './live-region';

describe('LiveRegion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces a changed message once and deduplicates identical state', () => {
    const { rerender } = render(<LiveRegion message="Техника обновлена" />);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByTestId('live-region')).toHaveTextContent('Техника обновлена');

    rerender(<LiveRegion message="Техника обновлена" />);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByTestId('live-region')).toHaveTextContent('Техника обновлена');

    rerender(<LiveRegion message="Открыт раздел Смены" />);
    expect(screen.getByTestId('live-region')).toBeEmptyDOMElement();
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByTestId('live-region')).toHaveTextContent('Открыт раздел Смены');
  });
});
