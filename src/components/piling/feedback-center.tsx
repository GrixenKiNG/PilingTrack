'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CheckCheck,
  Info,
  RefreshCw,
  ShieldCheck,
  Siren,
  X,
  XCircle,
} from 'lucide-react';
import { authFetch } from '@/lib/api';
import { usePilingStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { FeedbackEventDTO, FeedbackEventPriority } from '@/lib/types';

// Shape of GET /api/ready (see src/app/api/ready) — the old ok/session fields
// never existed in the response, so the panel permanently showed "unknown / not set".
interface ReadyPayload {
  ready: boolean;
  checks?: {
    database?: { status?: string; latencyMs?: number };
    environment?: { status?: string };
  };
}

interface FeedbackSummary {
  total: number;
  unread: number;
  error: number;
  warn: number;
  success: number;
  critical: number;
  ackPending: number;
}

const OPEN_POLL_INTERVAL_MS = 30_000;
const CLOSED_POLL_INTERVAL_MS = 180_000;
const HIDDEN_POLL_INTERVAL_MS = 300_000;
const HEALTH_REFRESH_INTERVAL_MS = 300_000;

function getLevelIcon(level: FeedbackEventDTO['level']) {
  switch (level) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'audit':
      return <ShieldCheck className="h-4 w-4 text-slate-500" />;
    default:
      return <Info className="h-4 w-4 text-blue-600" />;
  }
}

function getPriorityBadge(priority: FeedbackEventPriority) {
  switch (priority) {
    case 'CRITICAL':
      return <Badge className="bg-red-100 text-red-700 hover:bg-red-100">Критично</Badge>;
    case 'HIGH':
      return <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Высокий</Badge>;
    case 'LOW':
      return <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">Низкий</Badge>;
    default:
      return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Средний</Badge>;
  }
}

function formatEventDate(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FeedbackCenter() {
  const user = usePilingStore((state) => state.currentUser);
  // Operators/assistants get a plain notifications feed; the platform-health
  // card, requestId lines and the "контур обратной связи" framing are ops/dev
  // detail that only confuses a field user (and /api/ready is admin-facing).
  const isPrivileged = user?.role === 'ADMIN' || user?.role === 'DISPATCHER';
  const localFeedbackEvents = usePilingStore((state) => state.localFeedbackEvents);
  const dismissLocalFeedbackEvent = usePilingStore((state) => state.dismissLocalFeedbackEvent);
  const clearLocalFeedbackEvents = usePilingStore((state) => state.clearLocalFeedbackEvents);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverEvents, setServerEvents] = useState<FeedbackEventDTO[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [health, setHealth] = useState<ReadyPayload | null>(null);

  const isMountedRef = useRef(false);
  const inFlightRef = useRef(false);
  const healthFetchedAtRef = useRef(0);

  const loadFeedback = useCallback(async (options?: { includeHealth?: boolean; silent?: boolean }) => {
    if (!user) {
      return;
    }

    if (inFlightRef.current) {
      return;
    }

    const includeHealth = options?.includeHealth ?? false;
    const silent = options?.silent ?? false;
    const shouldLoadHealth =
      includeHealth &&
      (user.role === 'ADMIN' || user.role === 'DISPATCHER') &&
      (healthFetchedAtRef.current === 0 || Date.now() - healthFetchedAtRef.current >= HEALTH_REFRESH_INTERVAL_MS);

    inFlightRef.current = true;
    if (!silent) {
      setLoading(true);
    }

    try {
      const requests: Promise<Response>[] = [authFetch('/api/feedback/events?limit=25')];
      if (shouldLoadHealth) {
        requests.push(fetch('/api/ready', { credentials: 'same-origin' }));
      }

      const [eventsRes, readyRes] = await Promise.all(requests);

      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        if (isMountedRef.current) {
          setServerEvents(eventsData.events || []);
          setSummary(eventsData.summary || null);
        }
      }

      if (readyRes?.ok) {
        const readyData = (await readyRes.json()) as ReadyPayload;
        healthFetchedAtRef.current = Date.now();
        if (isMountedRef.current) {
          setHealth(readyData);
        }
      }
    } finally {
      inFlightRef.current = false;
      if (!silent && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user]);

  const updateEventState = useCallback(
    async (eventId: string, operation: 'read' | 'acknowledge') => {
      const response = await authFetch('/api/feedback/events', {
        method: 'POST',
        body: JSON.stringify({ eventId, operation }),
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      setServerEvents((current) =>
        current.map((event) => (event.id === eventId ? payload.event : event))
      );
      await loadFeedback();
    },
    [loadFeedback]
  );

  const markAllRead = useCallback(async () => {
    const response = await authFetch('/api/feedback/events', {
      method: 'POST',
      body: JSON.stringify({ operation: 'read_all' }),
    });

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    setServerEvents(payload.events || []);
    setSummary(payload.summary || null);
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    isMountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void loadFeedback({ includeHealth: true });

    const getIntervalMs = () => {
      if (document.hidden) return HIDDEN_POLL_INTERVAL_MS;
      return open ? OPEN_POLL_INTERVAL_MS : CLOSED_POLL_INTERVAL_MS;
    };

    let intervalId = window.setInterval(() => {
      void loadFeedback({ includeHealth: open, silent: true });
    }, getIntervalMs());

    const restartInterval = () => {
      window.clearInterval(intervalId);
      intervalId = window.setInterval(() => {
        void loadFeedback({ includeHealth: open, silent: true });
      }, getIntervalMs());
    };

    const handleVisibilityChange = () => {
      restartInterval();
      if (!document.hidden) {
        void loadFeedback({ includeHealth: true, silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [loadFeedback, open, user]);

  useEffect(() => {
    if (!open) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void loadFeedback({ includeHealth: true, silent: true });

    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource('/api/feedback/stream', { withCredentials: true });
      source.addEventListener('sync', () => {
        attempt = 0;
        void loadFeedback();
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        const delay = Math.min(30_000, 1_000 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [loadFeedback, open]);

  const mergedEvents = useMemo(() => {
    const combined = [...localFeedbackEvents, ...serverEvents];
    return combined
      .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
      .slice(0, 30);
  }, [localFeedbackEvents, serverEvents]);

  const localUnread = localFeedbackEvents.length;
  const serverUnread = summary?.unread || 0;
  const unreadCount = localUnread + serverUnread;
  const warningCount = mergedEvents.filter((event) => event.level === 'warn' || event.level === 'error').length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-slate-100">
          <Bell className="h-4.5 w-4.5 text-slate-600" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-3xs font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[440px] overflow-y-auto p-0">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <SheetTitle className="text-left">{isPrivileged ? 'Контур обратной связи' : 'Уведомления'}</SheetTitle>
              <p className="mt-1 text-xs text-slate-500">
                {isPrivileged
                  ? 'События, ошибки, подтверждения операций и эксплуатационные сигналы.'
                  : 'Ваши отчёты, входы в систему и важные сообщения.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => void loadFeedback({ includeHealth: true })} size="sm" variant="outline" className="h-8 text-xs">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4 p-5">
          <div className={`grid gap-3 ${isPrivileged ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isPrivileged && (
              <div className="rounded-xl border bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Состояние платформы</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {health?.ready ? 'Система готова' : 'Проверка состояния'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  База: {health?.checks?.database?.status === 'pass' ? 'в норме' : 'нет ответа'} / Окружение: {health?.checks?.environment?.status === 'pass' ? 'в норме' : 'проблема'}
                </p>
              </div>
            )}
            <div className="rounded-xl border bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Активные сигналы</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{warningCount}</p>
              <p className="mt-1 text-xs text-slate-500">
                Непрочитанные: {unreadCount} / Критичные: {summary?.critical || 0}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Всего: {summary?.total ?? mergedEvents.length}</Badge>
            <Badge variant="outline">Непрочитанные: {unreadCount}</Badge>
            <Badge variant="outline">Ожидают подтверждения: {summary?.ackPending || 0}</Badge>
            {localFeedbackEvents.length > 0 && (
              <Badge variant="outline">Локальные: {localFeedbackEvents.length}</Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void markAllRead()} size="sm" variant="outline" className="h-8 text-xs">
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              Отметить всё как прочитанное
            </Button>
            {localFeedbackEvents.length > 0 && (
              <Button onClick={clearLocalFeedbackEvents} size="sm" variant="outline" className="h-8 text-xs">
                Очистить локальные
              </Button>
            )}
          </div>

          {mergedEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">
              Событий пока нет. Когда появятся ошибки, подтверждения операций или аудиторские записи, они будут видны здесь.
            </div>
          ) : (
            <div className="space-y-3">
              {mergedEvents.map((event) => {
                const canAcknowledge =
                  event.source === 'server' &&
                  (user?.role === 'ADMIN' || user?.role === 'DISPATCHER') &&
                  (event.level === 'warn' || event.level === 'error') &&
                  !event.acknowledgedAt;

                return (
                  <div
                    key={`${event.source}-${event.id}`}
                    className={`rounded-xl border bg-white p-3 shadow-sm transition-opacity ${
                      event.unread ? 'border-orange-200' : 'opacity-90'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        {getLevelIcon(event.level)}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                            {getPriorityBadge(event.priority)}
                            <Badge variant="secondary" className="text-3xs">
                              {event.source === 'client' ? 'локально' : event.scope}
                            </Badge>
                            {event.unread && (
                              <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Новое</Badge>
                            )}
                            {event.acknowledgedAt && (
                              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                Подтверждено
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{event.message}</p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-slate-500">
                            <span>{formatEventDate(event.createdAt)}</span>
                            {isPrivileged && event.requestId && <span>requestId: {event.requestId}</span>}
                            {event.actorName && <span>Инициатор: {event.actorName}</span>}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {event.source === 'server' && event.unread && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => void updateEventState(event.id, 'read')}
                              >
                                Отметить как прочитанное
                              </Button>
                            )}
                            {canAcknowledge && (
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-slate-900 hover:bg-slate-800"
                                onClick={() => void updateEventState(event.id, 'acknowledge')}
                              >
                                <Siren className="mr-1.5 h-3.5 w-3.5" />
                                Подтвердить обработку
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                      {event.source === 'client' && (
                        <button
                          onClick={() => dismissLocalFeedbackEvent(event.id)}
                          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
