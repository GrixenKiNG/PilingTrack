export function formatNumber(value: number, maxFractionDigits = 1): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function formatPercent(value: number, maxFractionDigits = 1): string {
  return `${formatNumber(value, maxFractionDigits)}%`;
}

/**
 * Fixed decimal places (ru-RU), zero-padded: formatFixed(12, 1) → "12,0".
 * Differs from formatNumber, which shows *up to* N decimals and drops
 * trailing zeros: formatNumber(12, 1) → "12". Use formatFixed when a value
 * must always render with the same precision (meters, prices, hours).
 */
export function formatFixed(n: number, decimals = 0): string {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Decimal hours → "Ч ч М мин" (drops zero parts). */
export function formatHours(hours: number): string {
  if (!hours || hours <= 0) return '0 ч';
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  if (mins === 0) return `${whole} ч`;
  if (whole === 0) return `${mins} мин`;
  return `${whole} ч ${mins} мин`;
}

/** Number with up to 2 decimals; null/undefined → "—". */
export function formatNum(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** ISO timestamp → coarse Russian relative time ("5 мин назад"). */
export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} дн назад`;
}

/**
 * Date string → "DD.MM.YYYY" (ru). Accepts a date-only `YYYY-MM-DD` or a full
 * ISO timestamp (only the date part is used). Timezone-safe: it slices the date
 * portion rather than going through `new Date()`, so an evening-UTC timestamp
 * never shifts a day. null/undefined/empty/malformed → "—".
 */
export function formatRuDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : '—';
}

/**
 * Full name → "Фамилия И.О." Handles "Surname Name Patronymic" and the
 * "Surname-first" order (detected by a patronymic suffix). One token → as-is;
 * empty → "—".
 */
export function formatPersonName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0];

  const patronymicPattern = /(вич|вна|ична|оглы|кызы)$/i;
  const surnameFirst = parts.length >= 3 && patronymicPattern.test(parts[2]);
  const surname = surnameFirst ? parts[0] : parts[parts.length - 1];
  const initialsSource = surnameFirst ? parts.slice(1) : parts.slice(0, -1);
  const initials = initialsSource
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}.`)
    .join('');
  return `${surname} ${initials}`.trim();
}

export function pluralizeRu(
  count: number,
  forms: readonly [one: string, few: string, many: string]
): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;

  if (abs > 10 && abs < 20) {
    return forms[2];
  }

  if (last > 1 && last < 5) {
    return forms[1];
  }

  if (last === 1) {
    return forms[0];
  }

  return forms[2];
}
