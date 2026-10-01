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

/**
 * Переменная явного (opt-in) включения уборки ключей идемпотентности.
 *
 * Живёт здесь, а не в воркере: по ней принимают решение ДВА слоя — планировщик
 * (workers/unified-worker.ts: стартовать или нет) и health-tracker
 * (checkers/schedulers.ts: требовать ли пульс). Литерал в двух местах разошёлся
 * бы молча — ровно та ловушка, ради которой заведён этот реестр.
 */
export const IDEMPOTENCY_CLEANUP_ENABLED_ENV = 'IDEMPOTENCY_CLEANUP_ENABLED';

/**
 * Включена ли суточная уборка ключей идемпотентности.
 *
 * По умолчанию ВЫКЛЮЧЕНА, включает только строка 'true' ('1', 'yes' и пустое
 * значение не считаются). Прежнее «включено, пока не 'false'» снято
 * (F-IDEMP-CLEANUP-OPTIN): у уборки открытая находка Codex (ревью out36,
 * R83 #1-2) — при перехвате зависшего `processing` `expiresAt` не обновляется,
 * и уборка может удалить АКТИВНЫЙ ключ. Пока `src/core/security/idempotency.ts`
 * не исправлен, включение по умолчанию удаляло бы живые ключи молча; опечатка
 * в боевом окружении должна оставлять уборку выключенной, а не включать её.
 */
export function isIdempotencyCleanupEnabled(): boolean {
  return process.env[IDEMPOTENCY_CLEANUP_ENABLED_ENV] === 'true';
}

/** Имена планировщиков (совпадают с тегами задач в Sentry). */
export const SCHEDULER_NAMES = [
  'pm-scheduler',
  'projection-rebuild',
  'readiness-scheduler',
  IDEMPOTENCY_CLEANUP_SCHEDULER_NAME,
] as const;

/**
 * Имена планировщиков, чей пульс health-tracker обязан найти.
 *
 * Выключенный планировщик пульса не пишет, и требовать его пульс нельзя: иначе
 * `/api/health/deep` навсегда показывал бы `degraded` со `staleSchedulers`
 * (R83 #3), и настоящая остановка уборки потерялась бы в постоянном шуме.
 */
export function enabledSchedulerNames(): string[] {
  return SCHEDULER_NAMES.filter(
    (name) => name !== IDEMPOTENCY_CLEANUP_SCHEDULER_NAME || isIdempotencyCleanupEnabled(),
  );
}
