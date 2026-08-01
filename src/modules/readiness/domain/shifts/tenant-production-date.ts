const DEFAULT_TIMEZONE = 'Europe/Moscow';

export function normalizeTenantTimezone(value: string | null | undefined): string {
  const timezone = value?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-CA', {timeZone: timezone}).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function tenantProductionDate(now: Date, timezone: string | null | undefined): Date {
  if (Number.isNaN(now.getTime())) throw new TypeError('Server time is invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTenantTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return new Date(`${read('year')}-${read('month')}-${read('day')}T00:00:00.000Z`);
}
