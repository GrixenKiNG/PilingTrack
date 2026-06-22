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
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
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
  { key: 'pending', label: 'В очереди', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { key: 'resolved', label: 'Решено', color: 'bg-green-100 text-green-700 border-green-200' },
  { key: 'discarded', label: 'Отброшено', color: 'bg-slate-100 text-slate-600 border-slate-200' },
  { key: 'all', label: 'Все', color: 'bg-blue-100 text-blue-700 border-blue-200' },
];

export function AdminDlq() {
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [stats, setStats] = useState<DlqStats | null>(null);
  const [status, setStatus] = useState<DlqStatus>('pending');
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeletonDuration(loading);
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      } else {
        setLoadError('Сервер не смог отдать список DLQ. Попробуйте обновить.');
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

  const handleAction = async (id: string, action: 'retry' | 'discard') => {
    if (action === 'discard' && !window.confirm('Отбросить событие? Оно больше не будет обработано.')) {
      return;
    }
    setActingId(id);
    try {
      const res = await authFetch('/api/admin/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка');
      }
      toast.success(action === 'retry' ? 'Событие отправлено повторно' : 'Событие отброшено');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setActingId(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU');
  };

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Dead Letter Queue
          </h1>
          <p className="text-sm text-slate-500 mt-1">
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
          <StatCard icon={Clock} label="В очереди" value={stats.pending} color="text-amber-600" bg="bg-amber-50" />
          <StatCard icon={CheckCircle2} label="Решено" value={stats.resolved} color="text-green-600" bg="bg-green-50" />
          <StatCard icon={XCircle} label="Отброшено" value={stats.discarded} color="text-slate-500" bg="bg-slate-50" />
          <StatCard icon={AlertTriangle} label="Всего" value={stats.total} color="text-blue-600" bg="bg-blue-50" />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
              status === f.key ? f.color : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
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
      ) : entries.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 className="w-12 h-12 text-green-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">DLQ пуст</p>
          <p className="text-xs text-slate-400 mt-1">Нет событий со статусом «{STATUS_FILTERS.find(f=>f.key===status)?.label}»</p>
        </div>
      ) : (
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
                        <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{entry.eventType}</code>
                        <Badge variant="secondary" className={STATUS_FILTERS.find(f=>f.key===entry.status)?.color}>
                          {STATUS_FILTERS.find(f=>f.key===entry.status)?.label || entry.status}
                        </Badge>
                        <span className="text-xs text-slate-500">попыток: {entry.attempts}</span>
                      </div>
                      {entry.aggregateId && (
                        <p className="text-xs text-slate-500 mt-1 font-mono truncate">
                          aggregateId: {entry.aggregateId}
                        </p>
                      )}
                      {entry.sourceOutboxId && (
                        <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">
                          outboxId: {entry.sourceOutboxId}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        Создано: {formatDate(entry.createdAt)}
                        {entry.updatedAt !== entry.createdAt && (
                          <span className="ml-2">· Обновлено: {formatDate(entry.updatedAt)}</span>
                        )}
                      </p>
                      <p className="text-sm text-red-600 mt-2 line-clamp-2">{entry.errorMessage}</p>
                      <button
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        className="text-xs text-blue-600 hover:underline mt-1"
                      >
                        {expandedId === entry.id ? 'Скрыть payload' : 'Показать payload'}
                      </button>
                      {expandedId === entry.id && (
                        <pre className="mt-2 text-3xs bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto max-h-60">
                          {JSON.stringify(entry.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                    {entry.status === 'pending' && (
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(entry.id, 'retry')}
                          disabled={actingId === entry.id}
                          className="h-8 text-xs"
                        >
                          {actingId === entry.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Повтор
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAction(entry.id, 'discard')}
                          disabled={actingId === entry.id}
                          className="h-8 text-xs text-red-600 hover:text-red-700"
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
        <p className="text-3xs text-slate-500 uppercase tracking-wide">{label}</p>
        <p className={cn('text-xl font-bold', color)}>{value}</p>
      </div>
    </div>
  );
}
