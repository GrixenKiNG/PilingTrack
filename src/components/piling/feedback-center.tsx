'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { usePilingStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { FeedbackEventDTO, FeedbackEventPriority } from '@/lib/types';
import {
  loadFeedbackFeed,
  replaceFeedbackEvent,
  replaceFeedbackFeed,
  useFeedbackFeed,
} from '@/components/piling/use-feedback-feed';

function getLevelIcon(level: FeedbackEventDTO['level']) {
  switch (level) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-success-strong" />;
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-warning-strong" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive-strong" />;
    case 'audit':
      return <ShieldCheck className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Info className="h-4 w-4 text-info-strong" />;
  }
}

function getPriorityBadge(priority: FeedbackEventPriority) {
  switch (priority) {
    case 'CRITICAL':
      return <Badge className="bg-destructive/10 text-destructive-strong hover:bg-destructive/10">Критично</Badge>;
    case 'HIGH':
      return <Badge className="bg-warning/10 text-warning-strong hover:bg-warning/10">Высокий</Badge>;
    case 'LOW':
      return <Badge className="bg-muted text-foreground hover:bg-muted">Низкий</Badge>;
    default:
      return <Badge className="bg-info/10 text-info-strong hover:bg-info/10">Средний</Badge>;
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

  // Лента, сводка и состояние системы общие для всех экземпляров: в админской
  // оболочке их два (десктопная и мобильная шапки живут в дереве
  // одновременно). См. `use-feedback-feed`.
  const {
    events: serverEvents,
    summary,
    health,
    loading,
  } = useFeedbackFeed({ enabled: Boolean(user), isPrivileged, open });

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
      replaceFeedbackEvent(eventId, payload.event);
      await loadFeedbackFeed();
    },
    []
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
    replaceFeedbackFeed(payload.events || [], payload.summary || null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadFeedbackFeed({ includeHealth: true, silent: true });

    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource('/api/feedback/stream', { withCredentials: true });
      source.addEventListener('sync', () => {
        attempt = 0;
        void loadFeedbackFeed();
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
  }, [open]);

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
        <button
          type="button"
          aria-label="Открыть уведомления"
          className="hit-target relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-muted"
        >
          <Bell className="h-4.5 w-4.5 text-muted-foreground" />
          {/* destructive-strong, а не red-500: белым по red-500 на 10px
              контраст 3.81 — ниже нормы для мелкого текста. */}
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-destructive-strong px-1 text-3xs font-bold text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-full overflow-y-auto p-0 sm:w-[440px]">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <SheetTitle className="text-left">{isPrivileged ? 'Контур обратной связи' : 'Уведомления'}</SheetTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {isPrivileged
                  ? 'События, ошибки, подтверждения операций и эксплуатационные сигналы.'
                  : 'Ваши отчёты, входы в систему и важные сообщения.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => void loadFeedbackFeed({ includeHealth: true })} size="sm" variant="outline" className="h-8 text-xs">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4 p-5">
          <div className={`grid gap-3 ${isPrivileged ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isPrivileged && (
              <div className="rounded-xl border bg-muted p-3">
                <p className="text-xs text-muted-foreground">Состояние платформы</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {health?.ready ? 'Система готова' : 'Проверка состояния'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  База: {health?.checks?.database?.status === 'pass' ? 'в норме' : 'нет ответа'} / Окружение: {health?.checks?.environment?.status === 'pass' ? 'в норме' : 'проблема'}
                </p>
              </div>
            )}
            <div className="rounded-xl border bg-muted p-3">
              <p className="text-xs text-muted-foreground">Активные сигналы</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{warningCount}</p>
              <p className="mt-1 text-xs text-muted-foreground">
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
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
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
                    className={`rounded-xl border bg-card p-3 shadow-sm transition-opacity ${
                      event.unread ? 'border-signal/30' : 'opacity-90'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        {getLevelIcon(event.level)}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{event.title}</p>
                            {getPriorityBadge(event.priority)}
                            <Badge variant="secondary" className="text-3xs">
                              {event.source === 'client' ? 'локально' : event.scope}
                            </Badge>
                            {event.unread && (
                              <Badge className="bg-signal/10 text-signal-strong hover:bg-signal/10">Новое</Badge>
                            )}
                            {event.acknowledgedAt && (
                              <Badge className="bg-success/10 text-success-strong hover:bg-success/10">
                                Подтверждено
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{event.message}</p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
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
                          aria-label="Закрыть уведомление"
                          title="Закрыть"
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground"
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
