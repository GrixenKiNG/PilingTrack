'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryErrorBanner, useMinSkeletonDuration } from '@/components/piling/async-ui';

interface UndeliveredLead {
  id: string;
  name: string;
  contact: string;
  message: string;
  deliveryError: string | null;
  createdAt: string;
}

/**
 * Заявки с сайта ORION, которые не дошли до Telegram. Заявка сохраняется до
 * отправки, поэтому здесь видно человека, которому нужно перезвонить, даже если
 * бот молчал. Спам-ловушка в список не попадает.
 */
export function AdminOrionLeads() {
  const [leads, setLeads] = useState<UndeliveredLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const showSkeleton = useMinSkeletonDuration(loading);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch('/api/admin/orion-leads?limit=100');
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
        setTotal(data.total || 0);
      } else if (res.status === 401) {
        setLoadError('Сессия истекла — войдите снова.');
      } else {
        setLoadError('Сервер не смог отдать список заявок. Попробуйте обновить.');
      }
    } catch {
      setLoadError('Не удалось связаться с сервером. Проверьте сеть и повторите.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
    load();
  }, [load]);

  return (
    <section aria-labelledby="orion-leads-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="orion-leads-title" className="text-base font-semibold">
          Заявки с сайта, не дошедшие в Telegram
        </h2>
        {!loading && !loadError && total > 0 && <Badge variant="destructive">{total}</Badge>}
      </div>

      {loadError && <QueryErrorBanner message={loadError} onRetry={load} retrying={loading} />}

      {!loadError && showSkeleton && <Skeleton className="h-20 w-full" />}

      {!loadError && !loading && leads.length === 0 && (
        <p className="text-sm text-muted-foreground">Все заявки с сайта дошли до Telegram.</p>
      )}

      {!loadError && !loading && leads.length > 0 && (
        <ul className="space-y-2">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Card>
                <CardContent className="space-y-1 p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{lead.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTimeInTimezone(lead.createdAt)}
                    </span>
                  </div>
                  <p>Контакт: {lead.contact}</p>
                  {lead.message && <p className="line-clamp-3 text-muted-foreground">{lead.message}</p>}
                  <p className="text-xs text-destructive">
                    Причина: {lead.deliveryError || 'не записана'}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {!loadError && !loading && total > leads.length && (
        <p className="text-xs text-muted-foreground">Показаны последние {leads.length} из {total}.</p>
      )}
    </section>
  );
}
