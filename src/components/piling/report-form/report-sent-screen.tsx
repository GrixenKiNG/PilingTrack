'use client';

import { formatNumber } from '@/lib/format';
import { IconTile } from '@/components/piling/icons';

interface ReportSentScreenProps {
  siteName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  totalPiles: number;
  totalPileMeters: number;
  totalDrillingCount: number;
  totalMeters: number;
  totalDowntime: number;
  hasDowntime: boolean;
  onDone: () => void;
}

function formatDate(date: string) {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}.${m}.${y}` : date;
}

export function ReportSentScreen({
  siteName, date, time, totalPiles, totalPileMeters,
  totalDrillingCount, totalMeters, totalDowntime, hasDowntime, onDone,
}: ReportSentScreenProps) {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <div className="flex-1 overflow-y-auto px-4 pt-12 pb-28">
        <div className="flex flex-col items-center text-center">
          <IconTile icon="handoff" label="Передано диспетчеру" tone="success" size={64} className="h-20 w-20" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Отчёт отправлен!</h1>
          <p className="mt-1 text-sm text-slate-500">Передано диспетчеру · сохранено в {time}</p>
        </div>

        <div className="mt-8 mx-auto w-full max-w-sm rounded-xl bg-white border shadow-sm divide-y">
          <Row label="Объект" value={siteName || '—'} />
          <Row label="Дата" value={formatDate(date)} />
          <Row label="Сваи" value={`${totalPiles} шт. / ${formatNumber(totalPileMeters)} м.п.`} />
          <Row label="Бурение" value={`${totalDrillingCount} шт. / ${formatNumber(totalMeters)} м.п.`} />
          {hasDowntime && <Row label="Простой" value={`${formatNumber(totalDowntime)} ч`} />}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t px-4 py-3 pb-safe">
        <button onClick={onDone}
          className="w-full h-14 rounded-lg font-semibold text-base bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white transition-all">
          Готово
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-semibold font-mono tabular-nums text-slate-900 text-right">{value}</span>
    </div>
  );
}
