'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  RefreshCw,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { catchText } from '@/components/piling/admin-crews/crew-messages';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner, useMinSkeletonDuration } from '@/components/piling/async-ui';
import { cn } from '@/lib/utils';

type DlqStatus = 'pending' | 'resolved' | 'discarded' | 'all';

interface DlqEntry {
  id: string;
  eventType: string;
  aggregateId: string | null;
  payload: unknown;
  errorMessage: string;
  attempts: number;
  sourceOutboxId: string | null;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'resolved' | 'discarded';
}

interface DlqStats {
  pending: number;
  resolved: number;
  discarded: number;
  total: number;
}

const STATUS_FILTERS: Array<{ key: DlqStatus; label: string; color: string }> = [
  { key: 'pending', label: 'Ожидают', color: 'bg-warning/10 text-warning-strong border-warning/30' },
  { key: 'resolved', label: 'Повтор поставлен в очередь', color: 'bg-success/10 text-success-strong border-success/30' },
  { key: 'discarded', label: 'Отброшены', color: 'bg-muted text-muted-foreground border-border' },
  { key: 'all', label: 'Все', color: 'bg-info/10 text-info-strong border-info/30' },
];

/**
 * Русские подписи для типов событий: админ должен понимать, что за событие
 * упало, а не читать машинный код (`ReportPdfDeliveryRequested`). Незнакомый
 * тип показываем как есть — словарь не обязан быть исчерпывающим.
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  ReportCreated: 'Отчёт создан',
  ReportUpdated: 'Отчёт изменён',
  ReportSubmitted: 'Отчёт отправлен',
  ReportDeleted: 'Отчёт удалён',
  ReportVersionCreated: 'Новая версия отчёта',
  PileWorkAdded: 'Добавлены сваи',
  PileWorkRemoved: 'Удалены сваи',
  DrillingAdded: 'Добавлено бурение',
  DrillingRemoved: 'Удалено бурение',
  DowntimeAdded: 'Добавлен простой',
  DowntimeRemoved: 'Удалён простой',
  ReportPdfDeliveryRequested: 'Доставка PDF отчёта',
  NotificationDeliveryRequested: 'Доставка уведомления',
  ReadinessSnapshotRequested: 'Пересчёт готовности',
};

function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

/**
 * Повтор у события доставки снова отправляет сообщение или PDF отчёта в
 * Telegram (dedupeKey намеренно не переносится), поэтому подтверждение должно
 * предупреждать об этом, а не просто «повторить?».
 */
function retryConfirmMessage(eventType: string): string {
  if (eventType === 'ReportPdfDeliveryRequested') {
    return 'Повторить событие? PDF отчёта уйдёт в Telegram заново — проверьте, что доставка не задублируется.';
  }
  if (eventType === 'NotificationDeliveryRequested' || eventType === 'ReportSubmitted') {
    return 'Повторить событие? Уведомление снова уйдёт в Telegram.';
  }
  return 'Повторить событие? Оно будет обработано заново; при повторном сбое появится новая запись в очереди.';
}

export function AdminDlq() {
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [stats, setStats] = useState<DlqStats | null>(null);
  const [status, setStatus] = useState<DlqStatus>('pending');
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeletonDuration(loading);
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch(`/api/admin/dlq?status=${status}&limit=200`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setStats(data.stats || null);
      } else if (res.status === 401) {
        // Сессия истекла — «Попробуйте обновить» тут не поможет.
        setLoadError('Сессия истекла — войдите снова.');
      } else {
        setLoadError('Сервер не смог отдать очередь недоставленных событий. Попробуйте обновить.');
      }
    } catch {
      setLoadError('Не удалось связаться с сервером. Проверьте сеть и повторите.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    load();
  }, [load]);

  const handleAction = async (entry: DlqEntry, action: 'retry' | 'discard') => {
    // Защита от двойного нажатия: пока предыдущее действие не завершилось,
    // повторный клик (в т.ч. по второй кнопке) ничего не делает.
    if (actingId) return;
    if (action === 'retry' && !window.confirm(retryConfirmMessage(entry.eventType))) {
      return;
    }
    if (action === 'discard' && !window.confirm('Отбросить событие? Оно будет исключено из обработки без возможности восстановления.')) {
      return;
    }
    setActingId(entry.id);
    try {
      const res = await authFetch('/api/admin/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка');
      }
      toast.success(action === 'retry' ? 'Повтор поставлен в очередь' : 'Событие отброшено');
      await load();
    } catch (e) {
      toast.error(catchText(e, 'Ошибка'));
    } finally {
      setActingId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Moscow',
    }).format(new Date(iso));

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning-strong" />
            Очередь недоставленных событий
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            События, упавшие после исчерпания попыток. Можно отправить повторно или отбросить.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Обновить
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Clock} label="Ожидают" value={stats.pending} color="text-warning-strong" bg="bg-warning/10" />
          <StatCard icon={CheckCircle2} label="Повтор поставлен в очередь" value={stats.resolved} color="text-success-strong" bg="bg-success/10" />
          <StatCard icon={XCircle} label="Отброшены" value={stats.discarded} color="text-muted-foreground" bg="bg-muted" />
          <StatCard icon={AlertTriangle} label="Всего" value={stats.total} color="text-info-strong" bg="bg-info/10" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              status === f.key ? f.color : 'bg-card text-muted-foreground border-border hover:bg-muted'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loadError && !loading ? (
        <QueryErrorBanner
          message={loadError}
          onRetry={() => void load()}
          retrying={loading}
        />
      ) : null}

      {showSkeleton ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : entries.length === 0 && !loadError ? (
        <div className="text-center py-16">
          <CheckCircle2 className="w-12 h-12 text-success/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Недоставленных событий нет</p>
          <p className="text-xs text-muted-foreground mt-1">Нет событий со статусом «{STATUS_FILTERS.find(f=>f.key===status)?.label}»</p>
        </div>
      ) : entries.length === 0 ? null : (
        <div className="space-y-2">
          {entries.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index < 20 ? index * 0.02 : 0 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{eventTypeLabel(entry.eventType)}</span>
                        <Badge variant="secondary" className={STATUS_FILTERS.find(f=>f.key===entry.status)?.color}>
                          {STATUS_FILTERS.find(f=>f.key===entry.status)?.label || entry.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">попыток: {entry.attempts}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Создано: {formatDate(entry.createdAt)}
                        {entry.updatedAt !== entry.createdAt && (
                          <span className="ml-2">· Обновлено: {formatDate(entry.updatedAt)}</span>
                        )}
                      </p>
                      <p className={cn('text-sm text-destructive-strong mt-2', expandedErrorId !== entry.id && 'line-clamp-2')}>
                        {entry.errorMessage}
                      </p>
                      <div className="flex items-center gap-3 flex-wrap mt-1">
                        {entry.errorMessage.length > 80 && (
                          <button
                            onClick={() => setExpandedErrorId(expandedErrorId === entry.id ? null : entry.id)}
                            className="text-xs text-info-strong hover:underline"
                          >
                            {expandedErrorId === entry.id ? 'Скрыть текст ошибки' : 'Показать текст ошибки полностью'}
                          </button>
                        )}
                        <button
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                          className="text-xs text-info-strong hover:underline"
                        >
                          {expandedId === entry.id ? 'Скрыть данные события' : 'Показать данные события'}
                        </button>
                      </div>
                      {expandedId === entry.id && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-muted-foreground">
                            Код события: <code className="font-mono">{entry.eventType}</code>
                          </p>
                          {entry.aggregateId && (
                            <p className="text-xs text-muted-foreground">
                              Объект события: <code className="font-mono">{entry.aggregateId}</code>
                            </p>
                          )}
                          {entry.sourceOutboxId && (
                            <p className="text-xs text-muted-foreground">
                              Исходное сообщение: <code className="font-mono">{entry.sourceOutboxId}</code>
                            </p>
                          )}
                          <pre className="text-3xs bg-muted border border-border rounded p-2 overflow-x-auto max-h-60">
                            {JSON.stringify(entry.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                    {entry.status === 'pending' && (
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(entry, 'retry')}
                          disabled={actingId === entry.id}
                          className="h-8 text-xs"
                        >
                          {actingId === entry.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Повтор
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(entry, 'discard')}
                          disabled={actingId === entry.id}
                          className="h-8 text-xs text-destructive-strong hover:text-destructive-strong"
                        >
                          <Trash2 className="w-3 h-3" />
                          Отбросить
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, color, bg,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className={cn('rounded-xl p-3 flex items-center gap-3', bg)}>
      <Icon className={cn('w-5 h-5', color)} />
      <div>
        <p className="text-3xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={cn('text-xl font-bold', color)}>{value}</p>
      </div>
    </div>
  );
}
