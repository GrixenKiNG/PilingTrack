export function safeText(value: unknown): string {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return text.replace(/\s+/g, ' ').trim();
}

export function formatNumber(value: number | null | undefined): string {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

export function formatMeters(value: number | null | undefined): string {
  return Number(value || 0).toFixed(1);
}

export function formatRuDate(value: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('ru-RU');
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
