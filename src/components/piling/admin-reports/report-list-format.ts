/**
 * Чистые форматтеры журнала отчётов (даты, смены, роли, проценты).
 * Выделено из admin-reports.tsx (аудит A-8: файл был 834 строки).
 */

import type { ReportDTO } from '@/lib/types';
import { getTodayInTimezone } from '@/lib/timezone';

/**
 * Производственный день тенанта («ГГГГ-ММ-ДД»), а не UTC-день и не день браузера:
 * `report.date` — день по поясу тенанта, и фильтры «Сегодня/Вчера/7 дней» должны
 * мерить тем же днём.
 */
export function todayYmd(): string {
  return getTodayInTimezone();
}

/** Сдвиг календарного дня на N дней: полдень UTC, без перевода часов. */
export function shiftYmd(days: number): string {
  const day = todayYmd();
  return new Date(new Date(`${day}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${d}.${m}`;
}

export function shiftLabel(report: ReportDTO): string {
  if (!report.shiftStart && !report.shiftEnd) return 'Смена не указана';
  return `${report.shiftStart || '--:--'} - ${report.shiftEnd || '--:--'}`;
}

export function formatIsoDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Администратор';
  if (role === 'DISPATCHER') return 'Диспетчер';
  if (role === 'ASSISTANT') return 'Помощник';
  return 'Оператор';
}

export function formatPercentValue(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}
