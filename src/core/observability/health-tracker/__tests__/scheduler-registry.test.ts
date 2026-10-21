/*
  Поведение реестра планировщиков (scheduler-registry.ts).

  Реестр — единственный источник имён планировщиков, префикса их пульса и
  правил включения (F-SCHED-REGISTRY-IDEMP, F-IDEMP-CLEANUP-OPTIN). Ошибка
  здесь тихая: health-tracker начал бы требовать пульс выключенного
  планировщика (вечный degraded) или перестал бы замечать остановку
  включённого.

  Границ (Redis, БД, S3, часы) у модуля нет — он читает только process.env,
  поэтому мокать нечего: проверяем настоящие решения на реальных значениях
  переменных окружения.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IDEMPOTENCY_CLEANUP_ENABLED_ENV,
  IDEMPOTENCY_CLEANUP_SCHEDULER_NAME,
  PDF_TEMP_CLEANUP_SCHEDULER_NAME,
  SCHEDULER_HEARTBEAT_PREFIX,
  SCHEDULER_NAMES,
  enabledSchedulerNames,
  isIdempotencyCleanupEnabled,
} from '../scheduler-registry';

const FLAG_KEYS = [
  'PM_SCHEDULER_ENABLED',
  'PROJECTION_REBUILD_ENABLED',
  'READINESS_SCHEDULER_ENABLED',
  IDEMPOTENCY_CLEANUP_ENABLED_ENV,
  'PDF_TEMP_CLEANUP_ENABLED',
] as const;

/** Планировщики, включённые «пока не сказано false». */
const ALWAYS_ON = ['pm-scheduler', 'projection-rebuild', 'readiness-scheduler'];

function clearFlags() {
  for (const key of FLAG_KEYS) delete process.env[key];
}

describe('scheduler-registry: кого health-tracker обязан проверять', () => {
  beforeEach(() => {
    clearFlags();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearFlags();
  });

  it('без настроек ждёт пульс трёх постоянных планировщиков, opt-in не требует', () => {
    expect(enabledSchedulerNames()).toEqual(ALWAYS_ON);
  });

  it("только точное 'false' выключает постоянный планировщик: '0' и пусто — нет", () => {
    for (const key of [
      'PM_SCHEDULER_ENABLED',
      'PROJECTION_REBUILD_ENABLED',
      'READINESS_SCHEDULER_ENABLED',
    ] as const) {
      vi.stubEnv(key, 'false');
    }
    expect(enabledSchedulerNames()).toEqual([]);

    // Иное значение (в том числе пустое) не выключает: правило — «пока не
    // сказано false», иначе опечатка в боевом окружении гасила бы пульс.
    for (const value of ['0', '']) {
      for (const key of [
        'PM_SCHEDULER_ENABLED',
        'PROJECTION_REBUILD_ENABLED',
        'READINESS_SCHEDULER_ENABLED',
      ] as const) {
        vi.stubEnv(key, value);
      }
      expect(enabledSchedulerNames()).toEqual(ALWAYS_ON);
    }
  });

  it("opt-in планировщики попадают в список только при строке 'true'", () => {
    vi.stubEnv(IDEMPOTENCY_CLEANUP_ENABLED_ENV, '1');
    vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', 'yes');
    expect(enabledSchedulerNames()).toEqual(ALWAYS_ON);

    vi.stubEnv(IDEMPOTENCY_CLEANUP_ENABLED_ENV, 'TRUE');
    vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', 'false');
    expect(enabledSchedulerNames()).toEqual(ALWAYS_ON);
  });

  it("isIdempotencyCleanupEnabled читает общую константу и включает только 'true'", () => {
    expect(isIdempotencyCleanupEnabled()).toBe(false);

    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      vi.stubEnv(IDEMPOTENCY_CLEANUP_ENABLED_ENV, value);
      expect(isIdempotencyCleanupEnabled(), `значение ${JSON.stringify(value)}`).toBe(false);
    }

    vi.stubEnv(IDEMPOTENCY_CLEANUP_ENABLED_ENV, 'true');
    expect(isIdempotencyCleanupEnabled()).toBe(true);
  });

  it('при обоих opt-in список полный и сохраняет порядок объявления', () => {
    vi.stubEnv(IDEMPOTENCY_CLEANUP_ENABLED_ENV, 'true');
    vi.stubEnv('PDF_TEMP_CLEANUP_ENABLED', 'true');

    expect(enabledSchedulerNames()).toEqual([
      ...ALWAYS_ON,
      IDEMPOTENCY_CLEANUP_SCHEDULER_NAME,
      PDF_TEMP_CLEANUP_SCHEDULER_NAME,
    ]);
  });

  it('выключение одного постоянного планировщика не выключает остальные', () => {
    vi.stubEnv('PROJECTION_REBUILD_ENABLED', 'false');

    expect(enabledSchedulerNames()).toEqual(['pm-scheduler', 'readiness-scheduler']);
  });

  it('реестр не содержит дублей, а имена и префикс пульса общие для workers и checker', () => {
    // Дубль в списке заставил бы health-tracker дважды спрашивать один ключ,
    // а разошедшийся литерал в воркере выглядел бы как «планировщик умер».
    expect(new Set(SCHEDULER_NAMES).size).toBe(SCHEDULER_NAMES.length);
    expect(SCHEDULER_NAMES).toEqual(expect.arrayContaining([...ALWAYS_ON]));
    expect(SCHEDULER_NAMES).toContain(IDEMPOTENCY_CLEANUP_SCHEDULER_NAME);
    expect(SCHEDULER_NAMES).toContain(PDF_TEMP_CLEANUP_SCHEDULER_NAME);
    // Формат ключа Redis — контракт: воркеры пишут по нему, checker читает.
    expect(SCHEDULER_HEARTBEAT_PREFIX).toBe('system:scheduler:');
  });
});
