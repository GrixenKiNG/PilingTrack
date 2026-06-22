/**
 * Timezone Utilities
 *
 * Ensures consistent date handling across client and server.
 * All dates are stored in UTC and converted to tenant timezone on display.
 *
 * Key rules:
 * - Server always stores/retrieves UTC
 * - Client sends dates in tenant timezone
 * - Report dates use the site's local timezone
 */

/**
 * Default timezone for the application (Moscow time for Russian construction industry).
 * Can be overridden per-tenant via environment variable.
 */
export const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'Europe/Moscow';

/**
 * Convert a UTC Date to a date string (YYYY-MM-DD) in the given timezone.
 */
export function utcToTimezoneDate(utcDate: Date | string, timezone: string = DEFAULT_TIMEZONE): string {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  
  // Use Intl.DateTimeFormat for timezone conversion
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  return formatter.format(date);
}

/**
 * Convert a local date string (YYYY-MM-DD) in the given timezone to UTC.
 */
export function timezoneDateToUtc(localDate: string, timezone: string = DEFAULT_TIMEZONE): Date {
  // Parse the local date and convert to UTC
  const [year, month, day] = localDate.split('-').map(Number);
  
  // Create a date in the target timezone, then convert to UTC
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  // Use the parts to construct the date in the timezone
  const parts = formatter.formatToParts(new Date(year, month - 1, day, 12, 0, 0));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const tzYear = parseInt(parts.find(p => p.type === 'year')!.value);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const tzMonth = parseInt(parts.find(p => p.type === 'month')!.value) - 1;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  const tzDay = parseInt(parts.find(p => p.type === 'day')!.value);
  
  // Create a date assuming the local timezone, then get UTC equivalent
  // This is approximate — for precise conversion, use a library like date-fns-tz
  return new Date(Date.UTC(tzYear, tzMonth, tzDay, 12, 0, 0));
}

/**
 * Normalize a report date string for storage.
 * Report dates are stored as strings (YYYY-MM-DD) in the site's local timezone.
 */
export function normalizeReportDate(dateStr: string): string {
  // Validate format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid report date format: ${dateStr}. Expected YYYY-MM-DD`);
  }
  return dateStr;
}

/**
 * Get shift type based on time of day in the local timezone.
 * DAY shift: 06:00 - 18:00
 * NIGHT shift: 18:00 - 06:00 (next day)
 */
export function getShiftTypeForTime(
  utcDate: Date | string,
  timezone: string = DEFAULT_TIMEZONE
): 'DAY' | 'NIGHT' {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  
  const timeStr = timeFormatter.format(date);
  const [hours] = timeStr.split(':').map(Number);
  
  // DAY: 06:00 - 17:59, NIGHT: 18:00 - 05:59
  return hours >= 6 && hours < 18 ? 'DAY' : 'NIGHT';
}

/**
 * Validate that a report date is not in the future (timezone-aware).
 */
export function isReportDateValid(dateStr: string, timezone: string = DEFAULT_TIMEZONE): boolean {
  const reportDate = new Date(`${dateStr}T00:00:00`);
  const nowInTimezone = new Date(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  );
  
  return reportDate <= nowInTimezone;
}
