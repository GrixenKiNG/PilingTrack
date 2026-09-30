'use client';

/**
 * EquipmentReportExport — generate a printable / PDF work report for one rig
 * over a day or a custom period. Reuses the existing period-PDF endpoint
 * (/api/reports/pdf) with an equipmentId filter:
 *   - "Открыть / печать" → opens the PDF inline in a new tab (browser viewer
 *     handles both print and save).
 *   - "Скачать PDF" → downloads as an attachment.
 *
 * GET is cookie-authenticated, so window.open / location carry the session.
 *
 * «Сегодня» и «N дней» отмеряются производственным днём организации, а не днём
 * браузера (F-R44-8): у машины с чужим поясом кнопка «Сегодня» печатала отчёт
 * за соседние сутки. Экран пояса не получает — берём его из /api/settings,
 * как соседние экраны (журнал отчётов отмеряет день тем же помощником).
 */

import { useEffect, useState } from 'react';
import { Printer, Download } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { getTodayInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';

/** День организации («ГГГГ-ММ-ДД»). До загрузки настроек — пояс по умолчанию. */
function todayYmd(timezone?: string): string {
  return getTodayInTimezone(timezone);
}

/** Сдвиг дня организации на N дней: полдень UTC, без перевода часов. */
function shiftYmd(days: number, timezone?: string): string {
  const day = todayYmd(timezone);
  return new Date(new Date(`${day}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function EquipmentReportExport({ equipmentId }: { equipmentId: string }) {
  const [timezone, setTimezone] = useState<string>();
  const [from, setFrom] = useState(() => todayYmd());
  const [to, setTo] = useState(() => todayYmd());
  const invalid = from > to;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await authFetch('/api/settings');
        if (!active || !res.ok) return;
        const zone = ((await res.json()) as { timezone?: string }).timezone;
        if (!zone) return;
        setTimezone(zone);
        // Пересчитываем только нетронутый период: выбор человека не перебиваем.
        setFrom((prev) => (prev === todayYmd() ? todayYmd(zone) : prev));
        setTo((prev) => (prev === todayYmd() ? todayYmd(zone) : prev));
      } catch {
        // Пояс не критичен: остаёмся на поясе по умолчанию.
      }
    })();
    return () => { active = false; };
  }, []);

  const url = (inline: boolean) => {
    const qs = new URLSearchParams({ dateFrom: from, dateTo: to, equipmentId });
    if (inline) qs.set('inline', '1');
    return `/api/reports/pdf?${qs.toString()}`;
  };

  const setToday = () => {
    const t = todayYmd(timezone);
    setFrom(t);
    setTo(t);
  };
  const setRange = (days: number) => {
    setTo(todayYmd(timezone));
    setFrom(shiftYmd(-(days - 1), timezone));
  };

  const chip = 'min-h-11 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted sm:min-h-0';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-muted-foreground">С</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11 rounded-md border border-border bg-card px-2 py-1 text-sm sm:min-h-0"
          />
        </label>
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-muted-foreground">По</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-11 rounded-md border border-border bg-card px-2 py-1 text-sm sm:min-h-0"
          />
        </label>
        <div className="flex gap-1">
          <button type="button" onClick={setToday} className={chip}>Сегодня</button>
          <button type="button" onClick={() => setRange(7)} className={chip}>7 дней</button>
          <button type="button" onClick={() => setRange(30)} className={chip}>30 дней</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => window.open(url(true), '_blank')}
          disabled={invalid}
          className="bg-signal hover:bg-signal-strong text-white"
        >
          <Printer className="mr-1.5 h-4 w-4" /> Открыть / печать
        </Button>
        <Button
          variant="outline"
          onClick={() => { window.location.href = url(false); }}
          disabled={invalid}
        >
          <Download className="mr-1.5 h-4 w-4" /> Скачать PDF
        </Button>
      </div>

      <p className={cn('text-xs', invalid ? 'text-destructive-strong' : 'text-muted-foreground')}>
        {invalid
          ? 'Дата «С» позже даты «По».'
          : 'Отчёт по этой установке за период: смены, сваи, бурение, простои. «Открыть» — печать или сохранение из просмотрщика браузера.'}
      </p>
    </div>
  );
}
