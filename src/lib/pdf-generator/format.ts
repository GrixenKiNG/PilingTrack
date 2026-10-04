// Локальные имена сохранены ради вызывающих (single-pdf, period-pdf, components),
// но сами правила берутся из общего @/lib/format: иначе в PDF точек заместо
// запятой и нет пробела в разрядах («12.5 шт/м.п.», «1200 м»).
import { formatFixed, formatNumber as formatNumberRu } from '@/lib/format';

export function safeText(value: unknown): string {
  // Не-конечные числа (NaN/±Infinity) — не текст: в PDF печаталось «NaN»/«Infinity».
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  if (value === null || value === undefined || value === '') return '—';
  // Строка из пробелов после сжатия даёт пустоту — тоже подстановка «—».
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? '—' : text;
}

export function formatNumber(value: number | null | undefined): string {
  const numeric = Number(value || 0);
  return formatNumberRu(numeric, Number.isInteger(numeric) ? 0 : 1);
}

export function formatMeters(value: number | null | undefined): string {
  return formatFixed(Number(value || 0), 1);
}

export function formatRuDate(value: string): string {
  if (!value) return '—';
  // Принимаем только строгую календарную дату ГГГГ-ММ-ДД; битую (abc, 2026-04,
  // 2026-02-30) не возвращаем «как есть» и не нормализуем в другой месяц.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '—';
  const [, year, month, day] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return '—';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d)}.${pad(m)}.${year}`;
}

export function shortId(value: string): string {
  return (value || '—').slice(0, 8).toUpperCase();
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    submitted: 'Отправлен',
    draft: 'Черновик',
    deleted: 'Удалён',
  };
  return labels[status] || status || '—';
}

export function shiftLabel(shiftType: string): string {
  const labels: Record<string, string> = {
    DAY: 'Дневная',
    NIGHT: 'Ночная',
  };
  return labels[shiftType] || shiftType || '—';
}

export function editorLabel(role: string | null, name: string | null): string {
  if (!name) return '—';
  const labels: Record<string, string> = {
    ADMIN: 'Администратор',
    DISPATCHER: 'Диспетчер',
    ASSISTANT: 'Помощник',
    OPERATOR: 'Оператор',
  };
  return `${labels[role || ''] || 'Оператор'}: ${name}`;
}
