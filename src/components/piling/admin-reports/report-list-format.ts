/**
 * Чистые форматтеры журнала отчётов (даты, смены, роли, проценты).
 * Выделено из admin-reports.tsx (аудит A-8: файл был 834 строки).
 */

import type { ReportDTO } from '@/lib/types';

export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
