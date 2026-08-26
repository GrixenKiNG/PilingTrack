'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { authFetch } from '@/lib/api';
import type { FeedbackEventDTO } from '@/lib/types';

/**
 * Общая лента обратной связи для всех смонтированных `<FeedbackCenter />`.
 *
 * Админская оболочка держит две шапки — десктопную (`hidden lg:flex`) и
 * мобильную (`lg:hidden`); прячется всегда только одна, но в дереве React
 * живут обе. Пока опрос сидел внутри компонента, каждый экземпляр заводил
 * свой `setInterval` и свой `inFlightRef` (`useRef` — свой у каждого
 * экземпляра, через границу инстансов он не дедуплицирует), и сервер получал
 * ровно вдвое больше запросов, чем нужно. Таймер и данные вынесены сюда:
 * сколько бы шапок ни было в дереве, опрос один.
 */

export const OPEN_POLL_INTERVAL_MS = 30_000;
export const CLOSED_POLL_INTERVAL_MS = 180_000;
export const HIDDEN_POLL_INTERVAL_MS = 300_000;
const HEALTH_REFRESH_INTERVAL_MS = 300_000;

// Shape of GET /api/ready (see src/app/api/ready) — the old ok/session fields
// never existed in the response, so the panel permanently showed "unknown / not set".
export interface ReadyPayload {
  ready: boolean;
  checks?: {
    database?: { status?: string; latencyMs?: number };
    environment?: { status?: string };
  };
}

export interface FeedbackSummary {
  total: number;
  unread: number;
  error: number;
  warn: number;
  success: number;
  critical: number;
  ackPending: number;
}

interface FeedbackFeedState {
  events: FeedbackEventDTO[];
  summary: FeedbackSummary | null;
  health: ReadyPayload | null;
  loading: boolean;
}

const useFeedbackFeedStore = create<FeedbackFeedState>(() => ({
  events: [],
  summary: null,
  health: null,
  loading: false,
}));

let inFlight = false;
let healthFetchedAt = 0;
let privileged = false;

export async function loadFeedbackFeed(options?: {
  includeHealth?: boolean;
  silent?: boolean;
}): Promise<void> {
  if (inFlight) {
    return;
  }

  const silent = options?.silent ?? false;
  const shouldLoadHealth =
    (options?.includeHealth ?? false) &&
    privileged &&
    (healthFetchedAt === 0 || Date.now() - healthFetchedAt >= HEALTH_REFRESH_INTERVAL_MS);

  inFlight = true;
  if (!silent) {
    useFeedbackFeedStore.setState({ loading: true });
  }

  try {
    const requests: Promise<Response>[] = [authFetch('/api/feedback/events?limit=25')];
    if (shouldLoadHealth) {
      requests.push(fetch('/api/ready', { credentials: 'same-origin' }));
    }

    const [eventsRes, readyRes] = await Promise.all(requests);

    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      useFeedbackFeedStore.setState({
        events: eventsData.events || [],
        summary: eventsData.summary || null,
      });
    }

    if (readyRes?.ok) {
      const readyData = (await readyRes.json()) as ReadyPayload;
      healthFetchedAt = Date.now();
      useFeedbackFeedStore.setState({ health: readyData });
    }
  } finally {
    inFlight = false;
    if (!silent) {
      useFeedbackFeedStore.setState({ loading: false });
    }
  }
}

/** Точечная замена одного события — ответ POST /api/feedback/events. */
export function replaceFeedbackEvent(eventId: string, event: FeedbackEventDTO): void {
  useFeedbackFeedStore.setState((state) => ({
    events: state.events.map((current) => (current.id === eventId ? event : current)),
  }));
}

/** Полная замена ленты — ответ операции read_all. */
export function replaceFeedbackFeed(
  events: FeedbackEventDTO[],
  summary: FeedbackSummary | null
): void {
  useFeedbackFeedStore.setState({ events, summary });
}

let mountedInstances = 0;
let openInstances = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function currentIntervalMs(): number {
  if (document.hidden) return HIDDEN_POLL_INTERVAL_MS;
  return openInstances > 0 ? OPEN_POLL_INTERVAL_MS : CLOSED_POLL_INTERVAL_MS;
}

function restartTimer(): void {
  if (timer) clearInterval(timer);
  if (mountedInstances === 0) {
    timer = null;
    return;
  }
  timer = setInterval(() => {
    void loadFeedbackFeed({ includeHealth: openInstances > 0, silent: true });
  }, currentIntervalMs());
}

function handleVisibilityChange(): void {
  restartTimer();
  if (!document.hidden) {
    void loadFeedbackFeed({ includeHealth: true, silent: true });
  }
}

/**
 * @param enabled — есть авторизованный пользователь (иначе не опрашиваем)
 * @param isPrivileged — ADMIN/DISPATCHER: только им отдаётся карточка /api/ready
 * @param open — панель этого экземпляра раскрыта (учащает общий опрос)
 */
export function useFeedbackFeed({
  enabled,
  isPrivileged,
  open,
}: {
  enabled: boolean;
  isPrivileged: boolean;
  open: boolean;
}): FeedbackFeedState {
  const state = useFeedbackFeedStore();

  useEffect(() => {
    privileged = isPrivileged;
  }, [isPrivileged]);

  useEffect(() => {
    if (!enabled) return;

    mountedInstances += 1;
    if (mountedInstances === 1) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      void loadFeedbackFeed({ includeHealth: true });
    }
    restartTimer();

    return () => {
      mountedInstances -= 1;
      if (mountedInstances === 0) {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      restartTimer();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !open) return;

    openInstances += 1;
    restartTimer();

    return () => {
      openInstances -= 1;
      restartTimer();
    };
  }, [enabled, open]);

  return state;
}
