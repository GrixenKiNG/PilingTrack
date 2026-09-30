import {fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {FeedbackEventDTO} from '@/lib/types';
import {FeedbackCenter} from './feedback-center';

vi.mock('@/lib/api', () => ({authFetch: vi.fn()}));

const state = vi.hoisted(() => ({
  currentUser: {
    id: 'operator-1',
    name: 'Оператор',
    email: 'operator@example.test',
    role: 'OPERATOR',
  } as Record<string, unknown>,
  events: [] as unknown[],
  localEvents: [] as unknown[],
}));

vi.mock('@/lib/store', () => ({
  usePilingStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentUser: state.currentUser,
    localFeedbackEvents: state.localEvents,
    dismissLocalFeedbackEvent: vi.fn(),
    clearLocalFeedbackEvents: vi.fn(),
  }),
}));

vi.mock('./use-feedback-feed', () => ({
  useFeedbackFeed: () => ({events: state.events, summary: null, health: null, loading: false}),
  loadFeedbackFeed: vi.fn(),
  replaceFeedbackEvent: vi.fn(),
  replaceFeedbackFeed: vi.fn(),
}));

function feedbackEvent(overrides: Partial<FeedbackEventDTO> = {}): FeedbackEventDTO {
  return {
    id: 'ev-1',
    level: 'warn',
    priority: 'HIGH',
    scope: 'auth',
    action: 'auth.login.failed',
    title: 'Ошибка входа',
    message: 'Попытка входа завершилась ошибкой авторизации.',
    audience: 'OPERATIONS',
    actorId: null,
    actorName: null,
    actorRole: null,
    targetId: null,
    requestId: null,
    metadata: null,
    readAt: null,
    acknowledgedAt: null,
    unread: true,
    source: 'server',
    createdAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('центр уведомлений', () => {
  beforeEach(() => {
    state.currentUser = {
      id: 'operator-1',
      name: 'Оператор',
      email: 'operator@example.test',
      role: 'OPERATOR',
    };
    state.events = [];
    state.localEvents = [];
    // Панель при открытии заводит SSE-поток; в happy-dom его нет.
    vi.stubGlobal('EventSource', class {
      addEventListener() {}
      close() {}
    });
  });

  it('даёт кнопке понятное имя и touch-target не меньше 44 px', () => {
    render(<FeedbackCenter />);

    const trigger = screen.getByRole('button', {name: 'Открыть уведомления'});
    expect(trigger).toHaveClass('h-11', 'w-11');
  });

  it('не показывает requestId текстом карточки, оставляя его в подсказке', () => {
    const requestId = '11111111-2222-3333-4444-555555555555';
    state.currentUser = {id: 'admin-1', name: 'Админ', email: 'admin@example.test', role: 'ADMIN'};
    state.events = [feedbackEvent({requestId})];

    render(<FeedbackCenter />);
    fireEvent.click(screen.getByRole('button', {name: 'Открыть уведомления'}));

    expect(screen.queryByText(/requestId/)).toBeNull();
    expect(screen.queryByText(new RegExp(requestId))).toBeNull();
    expect(screen.queryByText(`requestId: ${requestId}`)).toBeNull();
    expect(screen.getByTitle(`requestId: ${requestId}`)).toBeInTheDocument();
  });
});

/**
 * R73 №50 — колокольчик в шапке всех экранов: кнопки панели были 32px
 * (`h-8 text-xs`). На телефоне (<640px) поднимаем цель до 44px (`min-h-11`),
 * на десктопе возвращаем прежние 32px (`sm:min-h-8`) — `min-height` сильнее
 * `height`, поэтому одного `h-8` для сброса мало.
 */
describe('центр уведомлений: цели нажатия на телефоне (R73 №50)', () => {
  it('кнопки панели не ниже 44px на телефоне, на десктопе прежние 32px', () => {
    state.currentUser = {id: 'admin-1', name: 'Админ', email: 'admin@example.test', role: 'ADMIN'};
    state.events = [feedbackEvent()];
    state.localEvents = [
      feedbackEvent({id: 'local-1', source: 'client', level: 'info', title: 'Локальное событие'}),
    ];

    render(<FeedbackCenter />);
    fireEvent.click(screen.getByRole('button', {name: 'Открыть уведомления'}));

    const names = [
      'Обновить',
      'Отметить всё как прочитанное',
      'Очистить локальные',
      'Отметить как прочитанное',
      'Подтвердить обработку',
    ];
    for (const name of names) {
      expect(screen.getByRole('button', {name}), name).toHaveClass('min-h-11', 'sm:min-h-8');
    }
  });
});
