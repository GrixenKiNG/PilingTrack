# W118 — флаги функций, которые всегда включены или выключены

Дата: 2026-10-08. Ветка: `hermes/q4-0926`. Только чтение; единственный созданный файл — этот отчёт.

## Итог

- Найдено 16 находок: 0 критично, 6 важно, 10 мелочь. Отдельно — таблица всех флагов (раздел «Флаги»).
- Все «переключаемые» флаги готовности (`READINESS_*`) в боевом окружении дают одно значение — `true`: их никто не задаёт ни в `.env*`, ни в `docker-compose*`. Только тестовый фикстур (`tests/fixtures/tech-readiness.fixture.ts:68-72`) выставляет значения.
- По умолчанию выключены и нигде не включаются: `IDEMPOTENCY_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_ENABLED`, `BACKUP_ENABLED` — их ветки «включено» в проде не выполняются.
- Флаг `readiness_audit_chain_v1` вычисляется и отдаётся в UI, но ни одна строка кода по нему не ветвится — флаг-пустышка.
- Отдельная группа — «мёртвые» флаги в шаблонах окружения: `OTEL_ENABLED`, `ASYNC_OUTBOX`, `S3_FORCE_PATH_STYLE`, `DATABASE_URL_PGBOUNCER` задаются генераторами `.env`, но в `src/` их никто не читает.

Топ-5:
1. `READINESS_*` (`src/modules/readiness/application/bootstrap-query.ts:35-43`) — всегда `true`, ветка «функция выключена» недостижима.
2. `readiness_audit_chain_v1` (`bootstrap-query.ts:41`) — вычисляется, но ни на что не влияет.
3. `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` (`src/components/piling/to/to-module.tsx:128-129`) — всегда `true`; альтернативная оболочка `referenceUi` мертва при дефолте.
4. `IDEMPOTENCY_CLEANUP_ENABLED` (`src/core/observability/health-tracker/scheduler-registry.ts:48-50`) — всегда `false`; уборка ключей не запускается.
5. `BACKUP_ENABLED` (`src/core/observability/health-tracker/checkers/backup.ts:17-21`) — дефолт `false`, в шаблоне `.env.production.example` отсутствует; мониторинг бэкапов молча выключен.

## Методика

Поиск по репозиторию (`D:\PillingR\wt-night`), инструмент — текстовый поиск по содержимому, плюс выборочное чтение файлов. Что искалось:

1. `process\.env\.[A-Z_]+` целиком по `src/` (≈300 совпадений) — инвентарь всех читаемых переменных.
2. Отбор флагов: шаблон `FEATURE_|ENABLE_|DISABLE_|_ENABLED|_FLAG` по всему репо; шаблон `process\.env\.[A-Z_]*(FEATURE|ENABLE|DISABLE|ENABLED|FLAG|MODE)[A-Z_]*`; проверки вида `flags.`, `featureFlags`, `isEnabled(`.
3. Для каждого флага — файл:строка чтения, значение по умолчанию (из кода), наличие в `.env.example`, `.env.docker.example`, `.env.production.example`, `setup.sh`, `scripts/generate-env-docker.ps1`, и в `docker-compose*.yml`.
4. Проверка «задаётся где-либо» — обратный поиск имени переменной по всему репо (код, скрипты, шаблоны, docs).
5. Проверка «мёртвых» имён из шаблонов — поиск имени в `src/` (ноль совпадений = нет потребителя).

Команды, воспроизводимые на этой машине (Windows Git Bash), можно повторить текстовым поиском:
- `FEATURE_|ENABLE_|DISABLE_|_ENABLED|_FLAG`
- `process\.env\.[A-Za-z_][A-Za-z0-9_]*`
- обратный поиск: `READINESS_SHIFTS_V1`, `IDEMPOTENCY_CLEANUP_ENABLED`, `PDF_TEMP_CLEANUP_ENABLED`, `BACKUP_ENABLED`, `EMBEDDED_WORKERS`, `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL`, `OTEL_ENABLED`, `ASYNC_OUTBOX`, `S3_FORCE_PATH_STYLE`, `DATABASE_URL_PGBOUNCER`.

Ограничения метода: значения в боевых `.env` на сервере недоступны (запрет AGENTS.md §1 — «No secrets»), поэтому вывод «нигде не задан» относится к репозиторию (код, шаблоны, compose, скрипты). Серверное окружение не проверено (см. «Не проверено»).

## Флаги (таблица из задания)

Значение по умолчанию — из кода. «Где задан» — только артефакты репозитория.

| Флаг | Где читается | Значение по умолчанию | Где задан | Кандидат на удаление | Причина |
|---|---|---|---|---|---|
| `READINESS_SHIFTS_V1` | `src/modules/readiness/application/bootstrap-query.ts:35` | `true` (включён, пока не задать иное) | только тест `tests/fixtures/tech-readiness.fixture.ts:69` | проверить вручную | В репо не задаётся → всегда `true`; «выключенная» ветка недостижима |
| `READINESS_PERMITS_V1` | `bootstrap-query.ts:38` | `true` | тест `tech-readiness.fixture.ts:70` | проверить вручную | То же |
| `READINESS_AUDIT_CHAIN_V1` | `bootstrap-query.ts:41` | `true` | тест `tech-readiness.fixture.ts:71` | да (или подключить) | Вычисляется и уходит в UI, но нигде не ветвится — см. находку 2 |
| `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` | `src/components/piling/to/to-module.tsx:128-129` | `true` (`!== 'false'`) | нигде (только тест `to-module-shell.test.tsx:308`) | проверить вручную | В проде всегда `true`, вторая оболочка не показывается |
| `PM_SCHEDULER_ENABLED` | `src/workers/unified-worker.ts:174` | `true` (`!== 'false'`) | нигде | нет | Кill-switch шедулера; задаётся только вручную в окружении |
| `PROJECTION_REBUILD_ENABLED` | `unified-worker.ts:180` | `true` | нигде | нет | То же |
| `READINESS_SCHEDULER_ENABLED` | `unified-worker.ts:187` | `true` | нигде | нет | То же |
| `IDEMPOTENCY_CLEANUP_ENABLED` | `src/core/observability/health-tracker/scheduler-registry.ts:49`, `unified-worker.ts:203` | `false` (только `'true'` включает) | нигде | нет | Осознанно выключен до фикса `idempotency.ts`; см. находку 4 |
| `PDF_TEMP_CLEANUP_ENABLED` | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:6` | `false` | нигде | нет (opt-in) | Уборка временных PDF не запускается |
| `PDF_TEMP_CLEANUP_DRY_RUN` | `pdf-cleanup-scheduler.ts:14` | `true` (`dryRun`, пока не `'false'`) | нигде | нет | Имеет смысл только когда включён предыдущий |
| `BACKUP_ENABLED` | `src/core/observability/health-tracker/checkers/backup.ts:18` | `false` | `docker-compose.yml:129` (как `${BACKUP_ENABLED:-}` — пусто) | нет, но задокументировать | Мониторинг бэкапов выключен, если не задать в `.env` |
| `ENABLED_WORKERS` | `src/workers/unified-worker/config.ts:12` | `'outbox,projection,pdf'` | `docker-compose.yml:178` (жёстко, без `${}`) | нет | Значение зафиксировано в compose, интерполяции нет |
| `EMBEDDED_WORKERS` | `src/workers/embedded-workers.ts:44-47` | `['outbox','projection']` (вне `NODE_ENV=test`) | нигде | нет | Встроенные воркеры всегда поднимаются в `app` |
| `MULTI_TENANT_MODE` | `src/services/tenancy/tenant-context-service.ts:16`, `src/proxy.ts:87` | `false`/`single` | `.env.example:11`, `.env.production.example:15`, `setup.sh:73`, `generate-env-docker.ps1:70,140` | нет | Оставлен намеренно (будущие тенанты); в проде всегда `false` |
| `RATE_LIMIT_BYPASS` | `src/lib/rate-limiter.ts:178` | `false` (только `'true'` и вне `production`) | нигде (только тест `rate-limiter.test.ts:198,210`) | нет | Тестовый обход лимитера, вне прода не действует |
| `TRUST_PROXY` | `rate-limiter.ts:479` | `false` | `docker-compose.yml:123` (`${TRUST_PROXY:-}`) | нет | Безопасность: за прокси задаётся владельцем |
| `OTEL_ENABLED` | — (в `src/` не читается) | — | `setup.sh:80`, `generate-env-docker.ps1:89` | да | Мёртвый флаг: записан в `.env.docker`, потребителя нет |
| `ASYNC_OUTBOX` | — (в `src/` не читается) | — | `generate-env-docker.ps1:158` | да | Мёртвый флаг |
| `S3_FORCE_PATH_STYLE` | — (в `src/` не читается) | — | `generate-env-docker.ps1:81,152` | да | Мёртвый флаг |
| `DATABASE_URL_PGBOUNCER` | — (в `src/` не читается; упомянут только в `scripts/switch-db.js:30`) | — | `generate-env-docker.ps1:119` | да | Мёртвое имя |
| `LOG_*` (10 имён) | `src/instrumentation.ts:20-26` и др. | `off` | нигде | нет | Отладочные переключатели, единое значение ожидаемо |

## Находки

| # | severity | path:line | Проблема | Сценарий / чем это плохо | Правка (предложение) |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/readiness/application/bootstrap-query.ts:35-43` | Флаги `READINESS_SHIFTS_V1`/`READINESS_PERMITS_V1`/`READINESS_AUDIT_CHAIN_V1` по умолчанию `true` и не задаются ни в `.env*`, ни в compose — в репо только тест `tests/fixtures/tech-readiness.fixture.ts:69-71`. | Ветки «фича выключена» (`tech-readiness-module.tsx:35-39`) при дефолтном окружении никогда не выполняются, а `bootstrap-query.ts:219-220` (`flags.readiness_shifts_v1 && can(...)`) всегда равно праву. Наличие kill-switch создаёт ложное впечатление настройки. | Решить с владельцем: либо задокументировать в `.env.example` как аварийный выключатель, либо убрать ветку |
| 2 | важно | `src/modules/readiness/application/bootstrap-query.ts:41`; `src/components/piling/to/readiness/api/contracts.ts:38,373` | `readiness_audit_chain_v1` вычисляется и передаётся в UI, но ни одна строка кода по нему не ветвится (обратный поиск: только объявление, контракт, тесты, docs). | Флаг-пустышка: переключение «включено/выключено» не меняет поведение — только присутствие в payload. Мёртвая настройка вводит в заблуждение. | Удалить флаг из `ReadinessFeatureFlags`/контракта либо подключить к реальной ветке аудита |
| 3 | важно | `src/components/piling/to/to-module.tsx:128-129,843,848` | `NEXT_PUBLIC_TECH_READINESS_PRODUCTION_SHELL` включён, пока не `'false'`; в репо не задаётся (только тест). | При дефолте `TECH_READINESS_PRODUCTION_SHELL_ENABLED === true`: строка `:848 if (!ENABLED) return referenceUi;` и `:843 showInternalNavigation={!ENABLED}` не выполняются — ветка `referenceUi` недостижима в проде. | Задокументировать флаг в `.env.example` (флаг сборки) или удалить дублирующую ветку |
| 4 | важно | `src/core/observability/health-tracker/scheduler-registry.ts:48-50`; `src/workers/unified-worker.ts:203` | `IDEMPOTENCY_CLEANUP_ENABLED` включается только строкой `'true'`, в репо не задаётся → всегда `false`. | Уборка просроченных ключей идемпотентности (TTL 7 суток) не запускается; ветка `startIdempotencyCleanupScheduler()` мертва. Комментарий `unified-worker.ts:199-202` прямо просит добавить переменную в compose — значит флаг заведомо «спит». | Оставить (есть открытый дефект `idempotency.ts`), но зафиксировать в шаблоне как выключенный opt-in |
| 5 | важно | `src/workers/unified-worker/pdf-cleanup-scheduler.ts:6,14` | `PDF_TEMP_CLEANUP_ENABLED` (дефолт `false`) и `PDF_TEMP_CLEANUP_DRY_RUN` (дефолт `true`) не заданы нигде. | Планировщик уборки временных PDF не стартует; тело `startPdfCleanupScheduler` (строки 10-26) в проде не исполняется. | Оставить как opt-in; упомянуть в `.env.example` (dry-run-first) |
| 6 | важно | `src/core/observability/health-tracker/checkers/backup.ts:17-21`; `docker-compose.yml:129` | `BACKUP_ENABLED` по умолчанию `false`; в compose проброшена как `${BACKUP_ENABLED:-}` (пусто), в `.env.production.example` отсутствует. | Метрики возраста бэкапа и выгрузки в S3 будут нулевыми, алерт `OffsiteBackupNotSynced` не сработает. `scripts/validate-env.ts:140-142` предупреждает — но переменной нет в шаблонах, задать её владельцу неоткуда. | Добавить `BACKUP_ENABLED` в `.env.production.example` |
| 7 | важно | `src/workers/embedded-workers.ts:26,44-47` | `EMBEDDED_WORKERS` не задана нигде → вне `test` всегда `['outbox','projection']`. | В контейнере `app` (`docker-compose.yml:72` `NODE_ENV=production`) по умолчанию поднимаются встроенные outbox+projection параллельно сервису `workers` (`ENABLED_WORKERS=outbox,projection,pdf`, `:178`). Разводит только leader election по Redis; из `.env` отключить нельзя (документация `docs/dev-modes.md:80` называет переменную неверно). | Задокументировать `EMBEDDED_WORKERS=none` и решить, нужны ли embedded в прод-app |
| 8 | мелочь | `src/workers/unified-worker/config.ts:12`; `docker-compose.yml:178` | `ENABLED_WORKERS` в compose задана жёстко (`outbox,projection,pdf`), без интерполяции. | Значение фиксировано: «переключаемость» из `.env` не работает, менять состав воркеров можно только правкой compose. | Интерполировать `${ENABLED_WORKERS:-outbox,projection,pdf}` либо оставить как осознанную константу |
| 9 | мелочь | `src/lib/rate-limiter.ts:178`, `:479` | `RATE_LIMIT_BYPASS` не задан нигде (кроме теста) — всегда `false`; `TRUST_PROXY` в compose проброшен как `${TRUST_PROXY:-}` (пусто). | Оба флага при дефолте дают одно значение. Для `RATE_LIMIT_BYPASS` это правильно (защита `NODE_ENV !== 'production'` на месте); `TRUST_PROXY` — вопрос настройки прода. | Документировать как тестовые/продовые переключатели |
| 10 | мелочь | `setup.sh:80`; `scripts/generate-env-docker.ps1:89` | `OTEL_ENABLED=false` записывается в `.env.docker`, но в `src/` нет ни одного обращения к `OTEL_*` (обратный поиск — ноль). | Мёртвый флаг: значение ни на что не влияет, телеметрия/tracing не поднимается. Пакеты `@opentelemetry/*` установлены, SDK не инициализирован. | Пометить как «не активно» либо убрать из генераторов |
| 11 | мелочь | `scripts/generate-env-docker.ps1:158` | `ASYNC_OUTBOX=true` пишется в `.env`, но в `src/` не читается. | Мёртвый флаг из наследия. | Убрать из генератора |
| 12 | мелочь | `scripts/generate-env-docker.ps1:81,152` | `S3_FORCE_PATH_STYLE=true` пишется в `.env`, в `src/` не читается (path-style, судя по всему, берётся из SDK-дефолта). | Мёртвый флаг: настройка адресации MinIO не работает через переменную. | Проверить необходимость и либо подключить, либо убрать |
| 13 | мелочь | `scripts/generate-env-docker.ps1:119` | `DATABASE_URL_PGBOUNCER` записывается в `.env`, в `src/` не читается (упоминается только в комментарии `scripts/switch-db.js:30`). | Мёртвое имя; при этом `switch-db.js` его перезаписывает, что создаёт иллюзию рабочей переменной. | Пометить/убрать |
| 14 | мелочь | `src/instrumentation.ts:20-26` и читатели `LOG_*` (`core/cache/response-cache.ts:361`, `core/infrastructure/leader-election.ts:15`, `services/reports/domain-events.ts:18`, `core/event-bus/schema-registry/registry.ts:6`, `modules/reports/application/projections/projection-worker.ts:109`, `workers/embedded-workers.ts:190`) | 10 переключателей `LOG_CACHE_STATS`, `LOG_WORKER_STATS`, `LOG_REDIS_LIFECYCLE`, `LOG_UNHANDLED_EVENTS`, `LOG_PROJECTION_SKIPS`, `LOG_WORKER_LIFECYCLE`, `LOG_LEADER_ELECTION`, `LOG_HANDLER_REGISTRATION`, `LOG_SCHEMA_REGISTRATION` (+ `LOG_LEVEL`) не заданы ни в `.env*`, ни в compose. | Всегда единое значение (тихий режим). Это ожидаемо для отладки, но «переключатели» фактически мертвы в репо. | Оставить как есть; при желании описать разово в шаблоне |
| 15 | мелочь | `src/services/tenancy/tenant-context-service.ts:13-18`; `src/proxy.ts:87` | `MULTI_TENANT_MODE` всегда `single`/`false` (`.env.example:11`, `.env.production.example:15`, `setup.sh:73`), в compose не задан. | Ветка `mode: 'multi'` (`tenant-context-service.ts:30-37`) при дефолте не выполняется. Оставлено намеренно (AGENTS.md: одна рабочая организация, код для будущих тенантов). | Не трогать (осознанное решение) |
| 16 | мелочь | `docker-compose.yml:129` vs `.env.production.example:44-55` | `BACKUP_ENABLED` есть в compose-пробросе, но отсутствует в шаблоне прода (там только `BACKUP_S3_*`). | Связка «переменная в compose ≠ переменная в шаблоне»: владелец не видит, что мониторинг бэкапов надо включить. (Пересечение с находкой 6.) | Добавить строку в `.env.production.example` |

## Не проверено

- Реальные значения переменных в боевых `.env`/`.env.production` на сервере — не читались (запрет AGENTS.md §1 «No secrets»). Поэтому вывод «нигде не задан» относится только к репозиторию. Если на сервере вручную задан, например, `READINESS_SHIFTS_V1=false`, поведение будет иным — «не проверено».
- Значения `.env`, `.env.docker`, `.env.local` на этой машине (gitignored, возможно устаревшие) — не читались намеренно; генераторы описаны по исходникам.
- Прогоны `npm run build`/`tsc`/тестов не делались: задача только на чтение, изменения кода не вносились. Соответствие «нет ошибок сборки» не проверялось.
- Ветка `docker-compose.staging.yml`/`.prod.yml` просмотрена на предмет проброса флагов; overlay-файлы ищутся теми же шаблонами, отдельных FEATURE/ENABLE-флагов там не найдено, но полный `docker compose config` с подстановкой `.env` не запускался (нет доступа к окружению).
- Поведение флагов в замороженных зонах (варианты экрана оператора, ORION) не анализировалось согласно AGENTS.md §1.
