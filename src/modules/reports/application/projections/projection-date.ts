/**
 * Рабочая дата события для проекций.
 *
 * Жила в projection-worker.ts, откуда её импортировали обработчики, а
 * обработчики импортировались обратно в воркер — замкнутый цикл модулей.
 * Держался он только на всплытии объявления функции: стоило переписать её в
 * `const … = () => …`, и одна из сторон получила бы undefined в момент
 * инициализации. Общая зависимость вынесена в отдельный модуль, цикла нет.
 */

import { ReportDomainEvent } from '@/modules/reports/domain';

export function getProjectionDate(event: ReportDomainEvent, fallbackDate?: string | null): string | null {
  // Рабочая дата смены важнее момента отправки. occurredAt — это когда отчёт
  // сохранили; операторы сплошь и рядом сдают смену задним числом (а админ
  // заводит неделю разом), и при прежнем порядке вся статистика уезжала в
  // день отправки: 49 отчётов за 03–10.08 легли бы одним днём. Тот же разбор
  // уже сделан для projectOperatorPerformance — там дату тоже берут из отчёта.
  const eventDate = typeof event.data?.date === 'string' ? event.data.date : null;
  if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return eventDate;
  }

  if (fallbackDate) return fallbackDate;

  if (event.occurredAt) {
    const occurredAt = new Date(event.occurredAt);
    if (!Number.isNaN(occurredAt.getTime())) {
      return occurredAt.toISOString().split('T')[0];
    }
  }

  return null;
}
