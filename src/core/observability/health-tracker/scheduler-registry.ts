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

/** Имена планировщиков (совпадают с тегами задач в Sentry). */
export const SCHEDULER_NAMES = [
  'pm-scheduler',
  'projection-rebuild',
  'readiness-scheduler',
] as const;
