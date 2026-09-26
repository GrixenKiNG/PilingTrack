/**
 * Timezone Utilities — Principal Engineer Implementation
 *
 * Solves the problem where client timezone differs from server UTC.
 * An operator in Vladivostok (+10) creating a report at 23:00 local time
 * should see the correct local date, not UTC date which may differ by 1 day.
 *
 * Usage:
 *   import { getTodayInTimezone, formatDateInTimezone } from '@/lib/timezone';
 *
 *   // Get today's date in user's timezone
 *   const today = getTodayInTimezone(user.timezone); // "2026-04-10"
 *
 *   // Format a UTC date for display in user's timezone
 *   const displayDate = formatDateInTimezone(report.createdAt, user.timezone);
 */

/**
 * Get today's date string (YYYY-MM-DD) in the specified timezone.
 */
export function getTodayInTimezone(timezone: string = 'Europe/Moscow'): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/**
 * The UTC instant of local midnight for a `YYYY-MM-DD` day in the given timezone.
 *
 * Dates in the product mean whole tenant days: a pile driven 26.09 at 00:30 MSK
 * (= 25.09T21:30Z UTC) belongs to the "26.09" journal, not "25.09". The offset
 * is resolved through Intl for the target instant, so zones that shift on DST
 * get the right boundary instead of a fixed offset.
 */
export function zonedDayStartUtc(date: string, timezone: string = 'Europe/Moscow'): Date {
  const [year, month, day] = date.split('-').map(Number);
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  // offset(instant) = what the zone's wall clock reads at that instant, minus the instant.
  const offsetAt = (instant: number): number => {
    const parts = formatter.formatToParts(new Date(instant));
    const read = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second')) - instant;
  };
  // Two passes: the first guess may fall on the other side of a DST switch.
  let utc = wallClock - offsetAt(wallClock);
  utc = wallClock - offsetAt(utc);
  return new Date(utc);
}

/**
 * Format a UTC Date for display in the user's timezone.
 */
export function formatDateInTimezone(
  date: Date | string,
  timezone: string = 'Europe/Moscow',
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'long',
  }
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ru-RU', {
    ...options,
    timeZone: timezone,
  }).format(d);
}

/**
 * Format a UTC datetime for display in the user's timezone with time.
 */
export function formatDateTimeInTimezone(
  date: Date | string,
  timezone: string = 'Europe/Moscow'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(d);
}

/**
 * Common timezones for user selection.
 */
export const COMMON_TIMEZONES = [
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
] as const;

/**
 * Detect user's browser timezone.
 */
export function detectBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
}
