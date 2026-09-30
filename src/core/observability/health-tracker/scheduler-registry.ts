/**
 * Реестр планировщиков контейнера `workers` (F-HEALTH-SCHEDULERS).
 *
 * Список имён — единственный источник: по нему пульс пишут сами планировщики
 * (src/workers/unified-worker/scheduler-heartbeat.ts) и по нему же health-tracker
 * решает, чей ключ истёк. Продублированные строки разошлись бы молча:
 * переименование в одном месте выглядело бы как «планировщик умер».
 *
 * Живёт в core, а не рядом с планировщиками: core не имеет права зависеть от
 * workers (scripts/check-layer-boundaries.ts), разрешённое направление импорта —
 * workers → core.
 */

/** Префикс ключей пульса. Планировщики дописывают к нему своё имя. */
export const SCHEDULER_HEARTBEAT_PREFIX = 'system:scheduler:';

/**
 * Имя планировщика уборки ключей идемпотентности.
 *
 * Одна константа на два слоя: по ней работник пишет пульс и тег Sentry
 * (workers/unified-worker/idempotency-cleanup-scheduler.ts), по ней же имя
 * попадает в SCHEDULER_NAMES для health-tracker. Литерал в двух местах
 * разошёлся бы молча — ровно то, что закрывает F-SCHED-REGISTRY-IDEMP.
 */
export const IDEMPOTENCY_CLEANUP_SCHEDULER_NAME = 'idempotency-cleanup';

/** Имена планировщиков (совпадают с тегами задач в Sentry). */
export const SCHEDULER_NAMES = [
  'pm-scheduler',
  'projection-rebuild',
  'readiness-scheduler',
  IDEMPOTENCY_CLEANUP_SCHEDULER_NAME,
] as const;
