import {ReadinessCommandError} from './command-pipeline/errors';

export interface ReadinessReadFilters {
  status?: string;
  from?: Date;
  to?: Date;
  shiftType?: 'DAY' | 'NIGHT';
  risk?: 'NORMAL' | 'ELEVATED';
  eventType?: string;
  actor?: string;
  equipmentId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function localBoundaryToUtc(value: string, edge: 'from' | 'to', timezone: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  const hour = edge === 'from' ? 0 : 23;
  const minute = edge === 'from' ? 0 : 59;
  const second = edge === 'from' ? 0 : 59;
  const millisecond = edge === 'from' ? 0 : 999;
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const probe = new Date(desired);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(probe);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const observed = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'), read('second'), millisecond);
  return new Date(desired + (desired - observed));
}

function parseInstant(value: string | null, edge: 'from' | 'to', timezone: string): Date | undefined {
  if (!value) return undefined;
  const date = ISO_DATE.test(value) ? localBoundaryToUtc(value, edge, timezone) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid ' + edge + ' date');
  }
  return date;
}

export function parseReadinessReadFilters(params: URLSearchParams, timezone = 'Europe/Moscow'): ReadinessReadFilters {
  const shiftType = params.get('shiftType');
  const risk = params.get('risk');
  if (shiftType && shiftType !== 'DAY' && shiftType !== 'NIGHT') {
    throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid shift type');
  }
  if (risk && risk !== 'NORMAL' && risk !== 'ELEVATED') {
    throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid permit risk');
  }
  let normalizedTimezone = timezone;
  try { new Intl.DateTimeFormat('en-CA', {timeZone: timezone}).format(new Date()); }
  catch { normalizedTimezone = 'Europe/Moscow'; }
  const from = parseInstant(params.get('from'), 'from', normalizedTimezone);
  const to = parseInstant(params.get('to'), 'to', normalizedTimezone);
  if (from && to && from > to) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'The from date must not be after to');
  }
  return {
    status: params.get('status') || undefined,
    from,
    to,
    shiftType: (shiftType || undefined) as ReadinessReadFilters['shiftType'],
    risk: (risk || undefined) as ReadinessReadFilters['risk'],
    eventType: params.get('eventType') || undefined,
    actor: params.get('actor') || undefined,
    equipmentId: params.get('equipmentId') || undefined,
  };
}

export function serializeReadinessFilters(filters: ReadinessReadFilters) {
  return Object.fromEntries(Object.entries({
    ...filters,
    from: filters.from?.toISOString(),
    to: filters.to?.toISOString(),
  }).filter(([, value]) => value !== undefined));
}
