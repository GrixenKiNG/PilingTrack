/**
 * Domain Events — Event Bus (in-memory, upgradable to Redis/Kafka)
 *
 * Central event bus for the application. Handlers subscribe to
 * specific event types. Events are dispatched synchronously within
 * the request, then persisted to outbox for reliable async processing.
 */

// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import type {
  ReportDomainEvent as DomainEvent,
} from '@/modules/reports/domain';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { REPORT_DOMAIN_EVENT_TYPES, normalizeReportDomainEventType } from '@/modules/reports/domain';
import { logger } from '@/lib/logger';

function shouldLogHandlerRegistration(): boolean {
  return process.env.LOG_HANDLER_REGISTRATION === 'true';
}

// Re-export for convenience — aliased from the report domain types so
// existing call sites that import `DomainEvent` from this module keep
// working unchanged.
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
export type {
  ReportDomainEvent as DomainEvent,
  ReportDomainEventType as DomainEventType,
} from '@/modules/reports/domain';

// ============================================================
// Event Handlers Registry
// ============================================================

type EventHandler = (event: DomainEvent) => void | Promise<void>;

const handlers = new Map<string, Set<EventHandler>>();

/**
 * Типы событий отчёта, у которых ПО ЗАМЫСЛУ нет подписчиков на этой шине.
 *
 * Это события уровня строки отчёта (свая/бурение/простой). Их обслуживает не
 * in-process шина отчётов, а другой маршрут:
 *   - SiteDailySummary пересобирается из строки Report на REPORT_SUBMITTED /
 *     REPORT_UPDATED (event-handlers.ts) — прежний обработчик на каждый
 *     PileWorkAdded/DrillingAdded убран намеренно;
 *   - CQRS-проекции читают те же события отдельным потребителем outbox
 *     (`projectOutboxEvents` → projection-worker, PROJECTABLE_EVENT_TYPES).
 * Поэтому отсутствие подписчика здесь — норма, а не потеря: событие не
 * теряется, у него просто иной маршрут. Поведение для этих типов прежнее
 * (logger.warn и выход), см. emitDomainEvent.
 *
 * Список сверен с реестром подписчиков (registerAllEventHandlers +
 * registerReadinessProjectionHandler) и с содержимым OutboxEvent локальной БД:
 * из всех типов отчётов подписчика на шине не имеют ровно эти пять.
 */
const EVENT_TYPES_WITHOUT_SUBSCRIBERS = new Set<string>([
  REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_ADDED,
  REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_REMOVED,
  REPORT_DOMAIN_EVENT_TYPES.DRILLING_ADDED,
  REPORT_DOMAIN_EVENT_TYPES.DRILLING_REMOVED,
  REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_REMOVED,
]);

/**
 * Register an event handler for a specific event type.
 */
export function on(eventType: string, handler: EventHandler) {
  const normalizedEventType = normalizeReportDomainEventType(eventType) || eventType;
  if (!handlers.has(normalizedEventType)) {
    handlers.set(normalizedEventType, new Set());
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  handlers.get(normalizedEventType)!.add(handler);
  if (shouldLogHandlerRegistration()) {
    logger.debug('Event handler registered', {
      eventType: normalizedEventType,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
      totalHandlers: handlers.get(normalizedEventType)!.size,
    });
  }
}

/**
 * Emit a domain event. Awaits all handlers (in parallel via Promise.allSettled
 * so a slow/failing one doesn't block the rest), then re-throws if any rejected.
 *
 * Re-throwing is critical: callers like the outbox publisher catch this and
 * use it to drive their retry/DLQ logic. Swallowing handler errors here used
 * to make the outbox think every event was processed successfully, even
 * when projections silently failed — attempts never incremented, DLQ never
 * received anything, and read models drifted out of sync without alerts.
 *
 * Handlers that legitimately should NOT fail the event (e.g. Telegram
 * notifications, audit logging) MUST swallow their own errors internally.
 * Critical handlers (analytics projections, daily summary) MUST propagate.
 */
export async function emitDomainEvent(event: DomainEvent | (Omit<DomainEvent, 'type'> & {type: 'NotificationDeliveryRequested' | 'ReportPdfDeliveryRequested'})): Promise<void> {
  if (event.type === 'NotificationDeliveryRequested') {
    const {deliverQueuedAlert} = await import('@/services/notifications/durable-alert-delivery');
    await deliverQueuedAlert(event);
    return;
  }
  if (event.type === 'ReportPdfDeliveryRequested') {
    const {deliverReportPdf} = await import('@/services/reports/event-handlers');
    await deliverReportPdf(event);
    return;
  }
  const reportEventType = normalizeReportDomainEventType(event.type);
  const normalizedType = reportEventType || event.type;
  const normalizedEvent =
    normalizedType === event.type ? event : { ...event, type: normalizedType };
  const eventHandlers = handlers.get(normalizedType);
  if (!eventHandlers || eventHandlers.size === 0) {
    // No subscribers — log as warn so silent gaps in registration are visible
    // by default. Previously this was debug-under-env-flag, which is how
    // 11 projection events vanished in production on 2026-05-20 with no trace.
    logger.warn('No handlers for domain event', {
      type: normalizedType,
      aggregateId: normalizedEvent.aggregateId,
    });
    // J2: для события ОТЧЁТА пустой реестр — ошибка, а не успех. Событие,
    // которое увидел outbox-публикатор до registerAllEventHandlers() (гонка на
    // старте воркера, N-4), иначе помечалось бы доставленным (dispatch-then-
    // claim) и терялось навсегда. Бросаем — outbox повторит, а после исчерпания
    // попыток отправит в dead-letter. Исключение — типы, которым подписчик не
    // нужен ПО ЗАМЫСЛУ (см. EVENT_TYPES_WITHOUT_SUBSCRIBERS): у них другой
    // маршрут, и отсутствие подписчика здесь не потеря.
    //
    // События НЕ отчётов (crew/site/equipment/readiness/… ) сюда не попадают:
    // normalizeReportDomainEventType для них возвращает null, и шина отчётов их
    // не обслуживает — для них прежнее warn + выход. Бросать по ним значило бы
    // увести на повтор/DLQ домены, которые локального подписчика не имеют и не
    // предполагают (они живут в outbox как журнал событий).
    if (reportEventType && !EVENT_TYPES_WITHOUT_SUBSCRIBERS.has(normalizedType)) {
      throw new Error(
        `No handlers for domain event ${normalizedType} (aggregateId=${normalizedEvent.aggregateId})`,
      );
    }
    return;
  }

  logger.info('Domain event emitted', {
    type: normalizedType,
    aggregateId: normalizedEvent.aggregateId,
    aggregateType: normalizedEvent.aggregateType,
    handlerCount: eventHandlers.size,
  });

  const results = await Promise.allSettled(
    Array.from(eventHandlers).map((handler) =>
      Promise.resolve().then(() => handler(normalizedEvent)),
    ),
  );

  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason);

  if (failures.length === 0) return;

  for (const err of failures) {
    logger.error(`Event handler error for ${normalizedType}`, err, {
      aggregateId: normalizedEvent.aggregateId,
    });
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  throw new AggregateError(
    failures,
    `${failures.length} handlers failed for ${normalizedType}`,
  );
}

/**
 * Get all registered event types (for diagnostics).
 */
export function getRegisteredEventTypes(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Get handler count for diagnostics.
 */
export function getHandlerCount(eventType: string): number {
  return handlers.get(eventType)?.size || 0;
}

// Handler registration moved to @/services/reports/event-handlers.
// Import registerAllEventHandlers directly from there to register
// synchronously at startup (avoids the fire-and-forget race that
// caused N-4: events firing before lazy import().then() resolved).
