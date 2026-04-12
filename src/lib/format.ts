export function formatNumber(value: number, maxFractionDigits = 1): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

export function formatPercent(value: number, maxFractionDigits = 1): string {
  return `${formatNumber(value, maxFractionDigits)}%`;
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
