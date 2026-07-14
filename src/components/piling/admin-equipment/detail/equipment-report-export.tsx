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
 */

import { useState } from 'react';
import { Printer, Download } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function EquipmentReportExport({ equipmentId }: { equipmentId: string }) {
  const [from, setFrom] = useState(todayYmd());
  const [to, setTo] = useState(todayYmd());
  const invalid = from > to;

  const url = (inline: boolean) => {
    const qs = new URLSearchParams({ dateFrom: from, dateTo: to, equipmentId });
    if (inline) qs.set('inline', '1');
    return `/api/reports/pdf?${qs.toString()}`;
  };

  const setToday = () => {
    const t = todayYmd();
    setFrom(t);
    setTo(t);
  };
  const setRange = (days: number) => {
    setTo(todayYmd());
    setFrom(shiftYmd(-(days - 1)));
  };

  const chip = 'rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-slate-400">С</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-2xs uppercase tracking-wide text-slate-400">По</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-slate-200 bg-card px-2 py-1 text-sm"
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
          className="bg-orange-500 hover:bg-orange-600 text-white"
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

      <p className={cn('text-xs', invalid ? 'text-rose-500' : 'text-slate-400')}>
        {invalid
          ? 'Дата «С» позже даты «По».'
          : 'Отчёт по этой установке за период: смены, сваи, бурение, простои. «Открыть» — печать или сохранение из просмотрщика браузера.'}
      </p>
    </div>
  );
}
