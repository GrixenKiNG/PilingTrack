import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {FeedbackCenter} from './feedback-center';

vi.mock('@/lib/api', () => ({authFetch: vi.fn()}));

vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentUser: {id: 'operator-1', name: 'Оператор', email: 'operator@example.test', role: 'OPERATOR'},
    localFeedbackEvents: [],
    dismissLocalFeedbackEvent: vi.fn(),
    clearLocalFeedbackEvents: vi.fn(),
  }),
}));

vi.mock('./use-feedback-feed', () => ({
  useFeedbackFeed: () => ({events: [], summary: null, health: null, loading: false}),
  loadFeedbackFeed: vi.fn(),
  replaceFeedbackEvent: vi.fn(),
  replaceFeedbackFeed: vi.fn(),
}));

describe('центр уведомлений', () => {
  it('даёт кнопке понятное имя и touch-target не меньше 44 px', () => {
    render(<FeedbackCenter />);

    const trigger = screen.getByRole('button', {name: 'Открыть уведомления'});
    expect(trigger).toHaveClass('h-11', 'w-11');
  });
});
