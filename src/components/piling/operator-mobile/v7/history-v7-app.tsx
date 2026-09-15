'use client';

import {useCallback, useEffect, useState} from 'react';
import type {ReportListItemDTO, ReportStatus} from '@/lib/types';
import {formatHours, formatNumber, formatRuDate} from '@/lib/format';
import {Button, Card, Chip, Empty, PhoneShell, Pick, Row, Title, type Tone} from './v7-ui';

/**
 * История смен машиниста в мобильной оболочке модуля оператора.
 *
 * Список отчётов приходит из `/api/reports/my` — того же источника, что у
 * настольной «Истории». Идентификатор пользователя намеренно НЕ передаём:
 * сервер сам ограничивает выборку правами смотрящего (`listReportsForUserScope`),
 * а параметр в адресе — это приглашение подставить чужой.
 *
 * Только чтение: отчёт правится там, где его завели.
 */

const STATUS_LABEL: Record<ReportStatus, string> = {
  draft: 'Черновик',
  submitted: 'Отправлен',
};

const STATUS_TONE: Record<ReportStatus, Tone> = {
  draft: 'warn',
  submitted: 'ok',
};

interface Page {
  reports: ReportListItemDTO[];
  nextCursor: string | null;
}

async function readPage(cursor: string | null): Promise<Page> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetch(`/api/reports/my${query}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const payload = await response.json().catch(() => null) as
    {data?: ReportListItemDTO[]; reports?: ReportListItemDTO[]; nextCursor?: string | null; error?: string} | null;
  if (!response.ok) {
    const error = new Error(payload?.error ?? 'Сервер не ответил');
    (error as Error & {status?: number}).status = response.status;
    throw error;
  }
  return {
    reports: payload?.data ?? payload?.reports ?? [],
    nextCursor: payload?.nextCursor ?? null,
  };
}

export function HistoryV7App() {
  const [reports, setReports] = useState<ReportListItemDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState<string>('all');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [clock, setClock] = useState('');
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await readPage(null);
      setReports(page.reports);
      setCursor(page.nextCursor);
      setError(null);
      setSyncedAt(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    } catch (cause) {
      if ((cause as Error & {status?: number}).status === 401) {
        window.location.href = '/login';
        return;
      }
      // Пустой список из-за отказа сервера — самая дорогая ложь этого экрана:
      // человек решает, что смен не было. Поэтому отказ виден отдельно (2026-05-30).
      setError(cause instanceof Error ? cause.message : 'Не удалось получить историю');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'}));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const update = () => setOnline(globalThis.navigator?.onLine ?? true);
    update();
    globalThis.addEventListener?.('online', update);
    globalThis.addEventListener?.('offline', update);
    return () => {
      globalThis.removeEventListener?.('online', update);
      globalThis.removeEventListener?.('offline', update);
    };
  }, []);

  const more = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await readPage(cursor);
      setReports((current) => [...current, ...page.reports]);
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось догрузить');
    } finally {
      setLoadingMore(false);
    }
  };

  const sites = [...new Map(reports.map((report) => [report.siteId, report.siteName])).entries()];
  const shown = site === 'all' ? reports : reports.filter((report) => report.siteId === site);

  return (
    <PhoneShell
      clock={clock}
      online={online}
      syncedAt={syncedAt}
      pending={0}
      back="Смена"
      onBack={() => { window.location.href = '/operator/v7'; }}
    >
      <Title note="Ваши смены, свежие сверху">История смен</Title>
      <div className="body">
        {error ? (
          <Card>
            <div className="empty" style={{color: 'var(--red)'}}>{error}</div>
            <div style={{padding: '0 13px 13px'}}>
              <Button onClick={() => void load()}>Повторить</Button>
            </div>
          </Card>
        ) : null}

        {sites.length > 1 ? (
          <div className="picks">
            <Pick on={site === 'all'} onClick={() => setSite('all')}>Все объекты</Pick>
            {sites.map(([id, name]) => (
              <Pick key={id} on={site === id} onClick={() => setSite(id)}>{name}</Pick>
            ))}
          </div>
        ) : null}

        <Card title={`Смен: ${shown.length}`}>
          {loading
            ? <Empty>Загружаем…</Empty>
            : shown.length === 0
              ? <Empty>{error ? 'История не получена' : 'Смен пока нет'}</Empty>
              : shown.map((report) => (
                <Row
                  key={report.id}
                  title={`${formatRuDate(report.date)} · ${report.siteName}`}
                  note={[
                    `свай: ${report.totalPiles}`,
                    report.totalPileMeters ? `${formatNumber(report.totalPileMeters)} м.п.` : null,
                    // `totalDrilling` — МЕТРЫ, штуки лежат в `totalDrillingCount`.
                    // Подписать метры как «бурение: 32,5» значит показать
                    // тридцать две скважины там, где их было четыре.
                    report.totalDrillingCount
                      ? `бурение: ${report.totalDrillingCount} скв.${report.totalDrilling ? `, ${formatNumber(report.totalDrilling)} м.п.` : ''}`
                      : null,
                    report.totalDowntime ? `простой: ${formatHours(report.totalDowntime)}` : null,
                  ].filter(Boolean).join(' · ')}
                  chip={<Chip tone={STATUS_TONE[report.status]}>{STATUS_LABEL[report.status]}</Chip>}
                />
              ))}
        </Card>

        {cursor ? (
          <Button tone="ghost" disabled={loadingMore} onClick={() => void more()}>
            {loadingMore ? 'Загружаем…' : 'Показать ещё'}
          </Button>
        ) : null}
      </div>
    </PhoneShell>
  );
}
