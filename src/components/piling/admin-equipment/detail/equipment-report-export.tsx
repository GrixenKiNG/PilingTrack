'use client';

/**
 * EquipmentReportExport — generate a printable / PDF work report for one rig
 * over a day or a custom period. Reuses the existing period-PDF endpoint
 * (/api/reports/pdf) with an equipmentId filter:
 *   - "Открыть / печать" → opens the PDF inline in a new tab (browser viewer
 *     handles both print and save).
 *   - "Скачать PDF" → downloads as an attachment.
 *
 * PDF тянется через authFetch и отдаётся из blob: сырой window.open/переход
 * показывали отказ (403/429/5xx) как страницу с JSON вместо файла и не давали
 * понять, что произошло (F-R115-8).
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
import { toast } from 'sonner';

/** День организации («ГГГГ-ММ-ДД»). До загрузки настроек — пояс по умолчанию. */
function todayYmd(timezone?: string): string {
  return getTodayInTimezone(timezone);
}

/** Сдвиг дня организации на N дней: полдень UTC, без перевода часов. */
function shiftYmd(days: number, timezone?: string): string {
  const day = todayYmd(timezone);
  return new Date(new Date(`${day}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Русский текст отказа выгрузки PDF: код статуса читателю ничего не говорит. */
async function pdfFailureText(response: Response): Promise<string> {
  if (response.status === 401) return 'Сессия истекла — войдите заново и повторите.';
  if (response.status === 403) return 'Нет прав на выгрузку отчёта. Обратитесь к администратору.';
  if (response.status === 429) return 'Слишком много выгрузок подряд. Подождите пару минут и повторите.';
  if (response.status >= 500) return 'Сервер не смог подготовить файл. Повторите попытку позже.';
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || 'Не удалось сформировать PDF. Повторите попытку.';
}

/** Имя файла из заголовка сервера, иначе — запасное. */
function pdfFileName(response: Response, fallback: string): string {
  return response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

export function EquipmentReportExport({ equipmentId }: { equipmentId: string }) {
  const [timezone, setTimezone] = useState<string>();
  const [from, setFrom] = useState(() => todayYmd());
  const [to, setTo] = useState(() => todayYmd());
  const [busy, setBusy] = useState(false);
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

  const handlePdf = async (inline: boolean) => {
    setBusy(true);
    // Новое окно открываем сразу в обработчике клика: вызов window.open после
    // await попадает под блокировку всплывающих окон, и «Открыть» не сработало бы.
    let win: Window | null = null;
    try {
      if (inline) {
        win = window.open('', '_blank');
        if (!win) {
          toast.error('Браузер заблокировал новое окно. Разрешите всплывающие окна и повторите.');
          return;
        }
      }
      const response = await authFetch(url(inline));
      if (!response.ok) {
        win?.close();
        toast.error(await pdfFailureText(response));
        return;
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      if (inline && win) {
        win.location.href = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = pdfFileName(response, `pilingtrack-report-${from}-${to}.pdf`);
        link.click();
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch».
      win?.close();
      toast.error(err instanceof TypeError
        ? 'Нет связи с сервером. Файл не сформирован — повторите при появлении сети.'
        : 'Не удалось сформировать PDF. Повторите попытку.');
    } finally {
      setBusy(false);
    }
  };

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
          onClick={() => { void handlePdf(true); }}
          disabled={invalid || busy}
          className="bg-signal hover:bg-signal-strong text-white"
        >
          <Printer className="mr-1.5 h-4 w-4" /> Открыть / печать
        </Button>
        <Button
          variant="outline"
          onClick={() => { void handlePdf(false); }}
          disabled={invalid || busy}
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
