# W107-CONFIG-DEV-DEFAULTS: значения по умолчанию, которые опасны на проде

## Итог

Найдено **32** места в `src/` и `scripts/`, где `process.env.X` подменяется dev-значением при отсутствии переменной. Из них: **критично — 12**, **важно — 10**, **мелочь — 10**.

Топ-5:
1. `src/services/auth/session-service.ts:74-79` — при `NODE_ENV !== 'production'` подписывает сессии публичной литералом `dev-only-session-secret-change-me`. Если на проде `NODE_ENV` не выставлен, любой может подделать сессию.
2. `src/core/security/encryption.ts:93-104` — без `ENCRYPTION_KEY*` и вне `production` генерируется случайный ключ: зашифрованные данные не переживают перезапуск (на проде ветка защищена `throw`).
3. `src/lib/redis-cache.ts:45,47`, `src/workers/unified-worker/config.ts:10`, `src/workers/pdf-worker.ts:26`, `src/lib/pdf-queue.ts:27` — `REDIS_URL`/`REDIS_URL_CACHE` по умолчанию `redis://localhost:6379`. Пропавшая переменная на проде тихо подменяет Redis локальным: лимит входа падает в память процесса, очереди и состояние расходятся.
4. `src/services/telemetry/device-key-service.ts:18` — `DEVICE_KEY_LOOKUP_SECRET` молча падает на `SESSION_SECRET` (переиспользование секрета: одна утечка ломает и сессии, и ключи устройств).
5. `src/core/observability/health-tracker/checkers/backup.ts:18-20` — пустой `BACKUP_ENABLED` = «мониторинг бэкапов выключен», метрики печатают `0` и алерт `OffsiteBackupNotSynced` не срабатывает.

Валидация окружения при старте **есть**, но кастомная (не `z.object`): `scripts/validate-env.ts`, вызывается из `package.json` (`predev`/`prebuild`/`prestart`, строки 7-11). Многие опасные переменные в ней помечены `required: false` или отсутствуют вовсе.

## Методика

Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`, только чтение. Поиски через `search_files`:
- `process\.env\.\w+\s*(\?\?|\|\|)\s*['"`]` по `src/` (47 совпадений) и `process\.env\.\w+\s*(\?\?|\|\|)\s*'` по `scripts/` (9 совпадений);
- `process\.env\.\w+` по `src/` (293 совпадения) — для тернарных и «выключительных» дефолтов (`!== 'false'`, `=== 'true'`);
- `process\.env\.\w+.*(localhost|127\.0\.0\.1|0\.0\.0\.0|'development')` по всему репо (26 совпадений);
- `changeme|'secret'|insecure|dev-secret` по `src/`;
- `z\.object|z\.string\(\)` по `src/` — env-схемы рядом с `process.env` не найдено;
- `validate-env|validateEnv`, `BACKUP_ENABLED|BACKUP_DIR`, `HOSTNAME|NEXTAUTH|AUTH_URL|ALLOWED_DEV_ORIGIN`.

Каждое `path:line` открыто через `read_file`. `.env*`, `docker-compose*`, `Dockerfile*` не открывались (запрет AGENTS.md). Замороженные области (operator-варианты, ORION) пропущены.

## Находки

Высокий приоритет (по классификации задания), затем остальное.

| # | severity | path:line | проблема | сценарий / чем важно | предлагаемое исправление |
|---|----------|-----------|----------|----------------------|--------------------------|
| 1 | критично | src/services/auth/session-service.ts:74-79 | `SESSION_SECRET`/`AUTH_SECRET` не задан и `NODE_ENV !== 'production'` → секрет подписи сессии = литерал `dev-only-session-secret-change-me` (значение в открытом виде в коде, длина 33) | Если `NODE_ENV` на проде не выставлен точно в `production`, JWT-сессии подписываются публично известной строкой — подделка любого пользователя/роли | Инвертировать: падать при отсутствии секрета всегда, кроме явного `NODE_ENV==='development'||'test'`; добавить в `ENV_CONFIG` `required` |
| 2 | критично | src/core/security/encryption.ts:93-104 | Нет `ENCRYPTION_KEY`/`ENCRYPTION_KEY_V1` и `NODE_ENV !== 'production'` → генерируется случайный ключ и логируется предупреждение | На проде с неверным `NODE_ENV` данные шифруются разовым ключом: расшифровка невозможна после рестарта (токены ботов, документы). Ветка `throw` (стр. 94-97) спасает только при точном `NODE_ENV==='production'` | Требовать ключ всегда в рантайме (не в build), вне dev/test — `throw` независимо от регистра/опечаток `NODE_ENV` |
| 3 | критично | src/lib/redis-cache.ts:45,47 | `REDIS_URL_CACHE`/`REDIS_URL` по умолчанию `redis://localhost:6379` | Пропавшая переменная на проде → `getRedisClient()`/`getStateRedisClient()` тихо идут на локальный (пустой) Redis: кэш мёртв, состояние (heartbeats, revocations) пишется не туда | Фейлить при отсутствии `REDIS_URL` вне dev/test; дефолт держать только для локального запуска |
| 4 | критично | src/workers/unified-worker/config.ts:10 | `REDIS_URL \|\| 'redis://localhost:6379'` | Воркеры (outbox/projection/pdf) на проде без переменной подключатся к локальному Redis → события не обрабатываются, но сервис не падает | То же: fail-fast вне dev |
| 5 | критично | src/workers/pdf-worker.ts:26 | `REDIS_URL \|\| 'redis://localhost:6379'` | PDF-воркер слушает локальную очередь; в проде задачи PDF silently не выполняются | То же |
| 6 | критично | src/lib/pdf-queue.ts:27 | `REDIS_URL \|\| 'redis://localhost:6379'` | Постановка PDF в очередь на «левый» Redis → отчёты не генерируются | То же |
| 7 | критично | src/services/telemetry/device-key-service.ts:18 | `const secret = explicitSecret \|\| fallbackSecret` — `DEVICE_KEY_LOOKUP_SECRET` молча заменяется на `SESSION_SECRET` | Один секрет защищает и сессии, и HMAC ключей устройств: компрометация `SESSION_SECRET` = возможность подбирать/проверять device-ключи; тихая деградация крипторазделения | Не подменять секреты: требовать `DEVICE_KEY_LOOKUP_SECRET` при `NODE_ENV==='production'` (это уже есть в validate-env, но код не падает) |
| 8 | критично | src/core/observability/health-tracker/checkers/backup.ts:18-20 | `BACKUP_ENABLED` пуст/не задан → `isBackupMonitoringEnabled()` = false, `checkBackupStatus()` отдаёт «здоров с source:disabled» | Мониторинг бэкапов молча выключен, метрики `backup_age_hours`/`backup_s3_synced` = 0 (см. metrics route), правило `OffsiteBackupNotSynced` не срабатывает — отсутствие бэкапов не замечают | Сделать мониторинг включённым по умолчанию либо фейлить/тревожить при отсутствии переменной на проде (уже упомянуто в validate-env как предупреждение) |
| 9 | критично | src/core/media/media-service.ts:505-506 | `S3_ACCESS_KEY_ID \|\| ''`, `S3_SECRET_ACCESS_KEY \|\| ''` — пустая строка как «секрет» | На проде без S3-переменных медиа-сервис строит клиент с пустыми ключами (в отличие от `s3-service.ts:29-31`, где есть `throw`) → загрузки/скачивания фото тихо ломаются | Повторить fail-closed проверку из `src/core/storage/s3-service.ts:29` |
| 10 | критично | src/app/api/media/[id]/download/route.ts:45-46 | `S3_ACCESS_KEY_ID \|\| ''`, `S3_SECRET_ACCESS_KEY \|\| ''` | Скачивание медиа с пустыми кредами → 500/отказ для пользователя без явной диагностики конфигурации | Fail-closed при отсутствии кред |
| 11 | критично | src/app/api/media/download-batch/route.ts:74-75 | `S3_ACCESS_KEY_ID \|\| ''`, `S3_SECRET_ACCESS_KEY \|\| ''` | Пакетные presigned-URL с пустыми кредами → пустой ответ/ошибка | Fail-closed при отсутствии кред |
| 12 | критично | src/lib/pdf-generator/cleanup.ts:40 | `accessKeyId ?? ''`, `secretAccessKey ?? ''` | Очистка временных PDF работает с пустыми кредами; при этом сама вызывается только при `isS3Enabled()` | Fail-closed при отсутствии кред |
| 13 | важно | src/core/notifications/telegram.ts:227,265,397 | `TELEGRAM_API_BASE \|\| 'https://api.telegram.org'` | На боевом сервере `api.telegram.org` заблокирован провайдером (комментарий validate-env.ts:130-132) — без переменной уведомления уходят «в никуда» и молча теряются | Оставить как есть (ситуация задокументирована) либо поднять предупреждение validate-env до рантайм-проверки |
| 14 | важно | scripts/apply-postgres-hardening.ts:21,248; scripts/explain-analyze.ts:169; scripts/setup-partitioning.ts:88 | `DATABASE_PROVIDER \|\| 'sqlite'` | Эксплуатационные скрипты без переменной выбирают sqlite-ветку; запуск на проде «не туда» даёт неверное поведение без явной ошибки | Убрать sqlite-дефолт или фейлить, если провайдер не задан |
| 15 | важно | src/lib/rate-limiter.ts:177-181 | `RATE_LIMIT_BYPASS === 'true'` действует при `NODE_ENV !== 'production'` | Тест-обход защиты от перебора активен, пока `NODE_ENV` не ровно `production`. Как и в #1/#2, опечатка/отсутствие `NODE_ENV` на проде снимает лимит попыток входа | Привязать обход к явному `NODE_ENV==='test'` (или отдельному allow-list в коде) |
| 16 | важно | src/services/telemetry/device-key-service.ts:25-31 | Fallback-HMAC `dev-only-device-key-fallback` при `NODE_ENV` не в {development,test} защищён только сравнением строк | Опечатка `NODE_ENV` (`Production`) включает слабый публичный ключ HMAC для ключей устройств | Проверять строго на «разрешённые» env, а не отсутствие production |
| 17 | важно | src/workers/embedded-workers.ts:44-47,26 | `EMBEDDED_WORKERS` пуст → вне `test` запускаются `['outbox','projection']` | Встроенные воркеры включаются по умолчанию: при отдельном worker-сервисе это двойная обработка/борьба за лидерство | Задокументировать/сделать явное `EMBEDDED_WORKERS=off` осознанным выбором (риск известен) |
| 18 | важно | src/workers/unified-worker.ts:174,180,187 | `PM_SCHEDULER_ENABLED !== 'false'`, `PROJECTION_REBUILD_ENABLED !== 'false'`, `READINESS_SCHEDULER_ENABLED !== 'false'` — планировщики включены по умолчанию | Любое значение кроме точного `'false'` (в т.ч. пусто/опечатка) включает планировщики; невыключаемые «на всякий случай» фоновые задачи | Инвертировать на `=== 'true'` для небезопасного по умолчанию поведения |
| 19 | важно | src/core/media/media-service.ts:502-503 | `S3_BUCKET \|\| 'pilingtrack-media'`, `S3_REGION \|\| 'us-east-1'` | Неверный бакет/регион по умолчанию → запись в чужой/несуществующий бакет | Сверять с единым источником конфигурации S3 |
| 20 | важно | src/core/storage/s3-service.ts:25,45 | `S3_REGION \|\| 'auto'`, `S3_BUCKET \|\| 'pilingtrack-reports'` | Регион/бакет по умолчанию (для MinIO ок), но на проде с частью переменных легко уехать в дефолтный бакет | Задокументировать/валидировать |
| 21 | важно | src/services/system/system-service.ts:68 | `NODE_ENV \|\| 'development'` в диагностике | `/api/system` показывает `development` на проде при отсутствии переменной — маскирует конфигурационную ошибку, вводит в заблуждение при разборе | Показывать фактическое значение без подмены |
| 22 | важно | src/services/telemetry/mqtt-ingestion-service.ts:58 | `(parseInt(MQTT_QOS \|\| '1') as 0\|1\|2) \|\| 1` | QoS телеметрии молча 1 при мусоре/отсутствии; для приёма данных замеров важно осознанно | Использовать строгий парсер (как env-int.ts) |
| 23 | мелочь | src/lib/db.ts:94-95 | `PRISMA_POOL_TIMEOUT \|\| '10'`, `PRISMA_CONNECTION_LIMIT \|\| '20'` | Дефолты пула БД; на проде при отсутствии — неожиданный лимит соединений. `parseInt` без проверки (отличие от env-int.ts) | Перенести на `positiveIntEnv` |
| 24 | мелочь | src/lib/redis-cache.ts:48 | `CACHE_DEFAULT_TTL \|\| '300'` | TTL кэша по умолчанию; `parseInt` без валидации | Использовать строгий парсер |
| 25 | мелочь | src/services/weather/weather-client.ts:82 | `WEATHER_API_BASE ?? 'https://api.open-meteo.com'` | Публичный сервис без токена — дефолт безопасен; риск только блокировки провайдером (уже отмечено в W94/W86) | Оставить, пробросить переменную через compose |
| 26 | мелочь | src/app/sitemap.ts:10 | `NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru'` | Публичный сайт по умолчанию — безопасно | — |
| 27 | мелочь | src/lib/pdf-generator/fonts.ts:10 | `WINDIR ? join(...) : 'C:\\Windows\\Fonts'` | Путь шрифтов по умолчанию только для Windows-хостинга | Оставить/задокументировать |
| 28 | мелочь | src/core/media/media-service.ts:508 | `MEDIA_MAX_FILE_SIZE \|\| '10485760'` | Лимит размера файла по умолчанию 10 МБ; `parseInt` без проверки | Строгий парсер |
| 29 | мелочь | scripts/app-role-smoke.ts:27; scripts/seed-checklist-blocks.ts:941; scripts/verify-readiness.ts:22 | `DEFAULT_TENANT_ID \|\| 'orion'` | Тенант по умолчанию совпадает с прод (`orion`) — на проде ок, но при втором тенанте скрипт может работать не с тем тенантом | Явно требовать тенант, если задан не прод |
| 30 | мелочь | scripts/dev/smoke-fleet-monitoring.ts:33 | `DEFAULT_TENANT_ID \|\| 'default'` | Dev-скрипт по умолчанию берёт несуществующий тенант `default` | Оставить (только dev) |
| 31 | мелочь | src/services/telemetry/mqtt-ingestion-service.ts:55,59 | `MQTT_CLIENT_ID \|\| `pilingtrack-${Date.now()}``, `MQTT_TOPIC_PREFIX \|\| 'pilingtrack/telemetry'` | Случайный clientId и дефолтный префикс топика; для приёма замеров важно совпадение с прошивкой | Задокументировать |
| 32 | мелочь | src/lib/pdf-generator/storage.ts:47,58 | `S3_REGION \|\| 'auto'`, `S3_BUCKET \|\| 'pilingtrack-reports'` | Дефолты бакета/региона для PDF (проходят проверку `isS3Enabled` по кредам) | Единый источник S3-конфигурации |

### Сводка по файлам

- `src/lib/redis-cache.ts` — #3, #24 (два Redis, дефолт localhost на обоих)
- `src/workers/*` — #4, #5, #17, #18
- `src/lib/pdf-queue.ts` — #6
- `src/services/telemetry/*` — #7, #16, #22, #31
- `src/services/auth/session-service.ts` — #1
- `src/core/security/encryption.ts` — #2
- `src/core/observability/health-tracker/checkers/backup.ts` — #8
- S3-креды (пустой секрет): #9, #10, #11, #12 (+ #19, #20, #27, #32 — дефолты бакета/региона), `src/core/storage/s3-service.ts:29-31` — единственный, где есть fail-closed
- `scripts/*` — #14, #29, #30; `scripts/validate-env.ts` — единственный механизм валидации (см. «Не проверено»)

### Проверка при старте

- **Есть**, но кастомная (не `z.object` рядом с `process.env`): `scripts/validate-env.ts:21-122` (`ENV_CONFIG`) + `:129-143` (`PRODUCTION_WARNINGS`), запускается через `package.json:7-11` (`predev`/`prebuild`/`prestart`).
- Дополнительно рантайм-проверка: `src/instrumentation.ts:46-50` — бросает ошибку, если `NODE_ENV==='production' && !SESSION_SECRET`.
- Важно: `SESSION_SECRET.validate` (`validate-env.ts:40-42`) знает только два placeholder-значения; литерал `dev-only-session-secret-change-me` из session-service там не перечислен.
- `DEVICE_KEY_LOOKUP_SECRET` помечен `required: false` (`validate-env.ts:47`) и становится обязательным только при `NODE_ENV==='production'` (`:176-183`).
- Многие из находок (`BACKUP_ENABLED`, `TRUST_PROXY`, `TELEGRAM_API_BASE`, `ALERTMANAGER_WEBHOOK_TOKEN`, `METRICS_SCRAPE_TOKEN`, `WEATHER_API_BASE`) либо только предупреждение, либо отсутствуют в `ENV_CONFIG`.

## Не проверено

- Файлы `.env`, `.env.example`, `.env.production.example`, `.env.docker.example` **не открывались** (запрет AGENTS.md §1) — фактические значения переменных на проде и их наличие не подтверждены.
- `docker-compose*`, `Dockerfile*`, `scripts/deploy-*` **не читались** (security-critical/off-limits): проброс этих переменных в контейнер не проверен (частично закрыто W94/W86).
- Какой `NODE_ENV` фактически выставлен на боевом сервере — не проверено (нет доступа к проду): от этого зависят острота находок #1, #2, #15, #16.
- `scripts/validate-env.ts` в проде не запускался; поведение сборки (`npm run build`) при отсутствии env не воспроизводил (нужен env/DB).
- Замороженные области (`src/app/(app)/operator/**`, `src/modules/operator-mobile/**` частично, `src/app/orion/**`, `src/app/api/orion/**`) пропущены по AGENTS.md; строка `src/modules/operator-mobile/application/knowledge-attempt.ts:8` просмотрена — там fail-closed (`throw`), но полный обход operator-вариантов не делал.
- `scripts/dev/smoke-*.ts` содержат самописный загрузчик `.env` (строки 13-29 / 8-24) — сам файл `.env` не читал, какие значения грузятся, не проверял.
- Проверки §6 (tsc/lint/test/build) не запускались: это read-only опись, изменения только в этом файле.
