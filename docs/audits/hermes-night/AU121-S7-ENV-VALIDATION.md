# AU121-S7-ENV-VALIDATION: проверка переменных окружения при старте

Версия кода: `git rev-parse HEAD` = `7aabd18a4070657975689215e365ba5b9d02670d` (ветка `hermes/q4-0926`).
Только чтение: код приложения не изменялся. Значения переменных не читались (`.env*` не открывались).
Статусы: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА.

## Итог

1. Валидатор окружения один — `scripts/validate-env.ts`. Он запускается ТОЛЬКО из npm-скриптов `dev`/`build`/`start` (`package.json:7,8,10`) и `validate:env` (`package.json:11`).
2. Прод-контейнер стартует напрямую `CMD ["node", "server.js"]` (`Dockerfile:119`) — `validate-env.ts` в контейнере НЕ запускается. Значит на боевом сервере обязательные переменные заранее не проверяются.
3. Единственная проверка на старте рантайма — `SESSION_SECRET` при `NODE_ENV=production` (`src/instrumentation.ts:46-50`), и только его наличие, без длины.
4. `ENCRYPTION_KEY` обязателен в compose (`docker-compose.yml:84,191`) и в коде бросает исключение (`src/core/security/encryption.ts:93-97`), но в `validate-env.ts` его нет вовсе — падение откладывается до первого шифрования/дешифрования.
5. Три обязательных по compose переменные продукт проверяет только на «не-заглушку» либо не проверяет вообще (см. таблицу); прод-«тихие отказы» (TELEGRAM_API_BASE, TRUST_PROXY, DB_IDENTITY_ROLE, BACKUP_ENABLED) дают лишь предупреждение и никогда не валят сборку (`scripts/validate-env.ts:129-153`).

## Методика

- `git rev-parse HEAD` — версия зафиксирована.
- `rg -n 'validate-env|validateEnv'` по всему репо → найдены точки запуска: `package.json:7,8,10,11`; сам валидатор `scripts/validate-env.ts`; ссылки в комментариях.
- `rg -o 'process\.env\.[A-Z_][A-Z0-9_]*' src scripts next.config.ts Dockerfile` → инвентарь читаемых переменных (≈100 имён).
- Прочитаны: `scripts/validate-env.ts` (полностью), `src/instrumentation.ts`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `src/lib/db.ts`, `src/core/security/encryption.ts:55-127`, `src/services/auth/session-service.ts:55-84`, `src/services/system/system-service.ts:10-40`, `src/services/telemetry/device-key-service.ts:1-35`, `src/workers/unified-worker/config.ts`, `src/workers/unified-worker/env-int.ts`, `src/lib/redis-cache.ts:45-137`, `src/lib/rate-limiter.ts:119,479`.
- Сверка с compose: базовый `docker-compose.yml` (полный `environment:`) + overlay `docker-compose.prod.yml` (применяется поверх базы, `docker-compose.prod.yml:5`). В overlay своих переменных почти нет (только `HOSTNAME`, `NODE_OPTIONS`, `SKIP_SEED` — строки 26-27,144), поэтому «в compose» = базовый файл.
- Повторить: `rg -n 'validate-env' package.json` и `rg -n 'requirements:|:?' docker-compose.yml`.

## Что и когда проверяется

Различаем три слоя:

1. `scripts/validate-env.ts` — run-time валидатор; выполняется только при `npm run dev|build|start`/`validate:env`. При ошибке `process.exit(1)` (`scripts/validate-env.ts:245`), иначе печатает предупреждения и продолжает.
2. `src/instrumentation.ts` — `register()`, вызывается Next.js на старте сервера; бросает исключение только если `NODE_ENV=production` и нет `SESSION_SECRET` (`src/instrumentation.ts:46-50`).
3. Compose `:?`-подстановки — падают при `docker compose up`, если переменная не задана в окружении хоста (`docker-compose.yml:46,78,81,85,191,293,354`).

## Таблица 1. Переменные по слою 1 (validate-env.ts) и наличие в compose

| # | Переменная | Проверка | Файл:строка | В compose (app/workers) | Что при отсутствии |
|---|---|---|---|---|---|
| 1 | `DATABASE_PROVIDER` | required + значение ∈ {sqlite,postgres} | src/../scripts/validate-env.ts:23-32,164-167 | да (`docker-compose.yml:48,80,170`) | validate-env падает; но код приложения её не читает — `src/lib/db.ts:40` всегда возвращает 'postgres' |
| 2 | `SESSION_SECRET` | required + длина ≥32 + не заглушка | scripts/validate-env.ts:33-45,164-167 | да, `:?`-required (`docker-compose.yml:83`) | validate-env падает; instrumentation бросает (`src/instrumentation.ts:46-50`); session-service бросает (`src/services/auth/session-service.ts:82`) |
| 3 | `DEVICE_KEY_LOOKUP_SECRET` | required при production + длина ≥32 | scripts/validate-env.ts:46-53,176-183 | да, `:?`-required (`docker-compose.yml:85`) | validate-env падает (prod); device-key бросает вне dev/test (`src/services/telemetry/device-key-service.ts:26-30`) |
| 4 | `DATABASE_URL_POSTGRES` | required при DATABASE_PROVIDER=postgres + префикс | scripts/validate-env.ts:56-65,170-173 | да (`docker-compose.yml:47,79,169`) | validate-env падает (при postgres) |
| 5 | `POSTGRES_PASSWORD` | НЕ required; только ≠ заглушки | scripts/validate-env.ts:66-75,90-92 | да, `:?`-required для postgres/migrate (`docker-compose.yml:354,46`) | validate-env молчит при отсутствии; падает compose |
| 6 | `REDIS_URL` | НЕ required; проверка префикса если задана | scripts/validate-env.ts:78-87,198-200 | да (`docker-compose.yml:81,171`) | предупреждение «rate limiting… in-memory» (`:199`); код падает на дефолт `redis://localhost:6379` (`src/lib/redis-cache.ts:47`) |
| 7 | `SENTRY_ORG` / `SENTRY_PROJECT` | НЕ required | scripts/validate-env.ts:90-91 | нет | молчание |
| 8 | `SENTRY_AUTH_TOKEN` | НЕ required; предупреждение на build | scripts/validate-env.ts:92,204-216 | нет (только в worker как `SENTRY_DSN`) | молчание / предупреждение: карты исходников не выгружаются (`next.config.ts:154`) |
| 9 | `MULTI_TENANT_MODE` | НЕ required; значение ∈ {false,single,multi,true} | scripts/validate-env.ts:95-104 | НЕТ в compose app/workers (только `DEFAULT_TENANT_ID`) | молчание; мультиаренда не включится (`src/proxy.ts:87`) |
| 10 | `DEFAULT_TENANT_ID` | НЕ required | scripts/validate-env.ts:105 | да (`docker-compose.yml:99,192`) | молчание; фолбэк тенанта теряется |
| 11 | `WEATHER_API_BASE` | НЕ required | scripts/validate-env.ts:112 | НЕТ в compose | молчание; дефолт `api.open-meteo.com` (`src/services/weather/weather-client.ts:82`) |
| 12 | `S3_ENDPOINT` | НЕ required | scripts/validate-env.ts:119 | да (пустой дефолт, `docker-compose.yml:86,179`) | молчание; локальный ФС фолбэк |
| 13 | `S3_ACCESS_KEY_ID` | НЕ required | scripts/validate-env.ts:120 | да (пустой дефолт, `:89,182`) | молчание; S3-health «disabled» (`src/core/observability/s3-health-check.ts:14`) |
| 14 | `S3_SECRET_ACCESS_KEY` | НЕ required | scripts/validate-env.ts:121 | да (пустой дефолт, `:90,183`) | молчание |

## Таблица 2. Прод-предупреждения (validate-env.ts:129-143) — не валят сборку

| # | Переменная | Проверка | Файл:строка | В compose | Что при отсутствии |
|---|---|---|---|---|---|
| 15 | `TELEGRAM_API_BASE` | только наличие, warn (NODE_ENV=production) | scripts/validate-env.ts:130-132,145-152 | да (пустой дефолт, `docker-compose.yml:91,184`) | молчание (не ошибка); уведомления уходят на заблокированный api.telegram.org (`src/core/notifications/telegram.ts:227`) |
| 16 | `TRUST_PROXY` | только наличие, warn | scripts/validate-env.ts:133-136 | да (пустой дефолт, `docker-compose.yml:123`) | молчание; один rate-limit bucket на весь домен (`src/lib/rate-limiter.ts:479`) |
| 17 | `DB_IDENTITY_ROLE` | только наличие, warn | scripts/validate-env.ts:137-139 | да (пустой дефолт, `docker-compose.yml:107,200`) | молчание; вход по email/ПИН/ключу устройства идёт без переключения роли (`src/core/security/identity-role.ts:35`) |
| 18 | `BACKUP_ENABLED` | только наличие, warn | scripts/validate-env.ts:140-142 | да (пустой дефолт, `docker-compose.yml:129`) | молчание; мониторинг бэкапов «up (disabled)» (`src/core/observability/health-tracker/checkers/backup.ts:18`) |

## Таблица 3. Обязательные по compose/коду, но НЕ в validate-env.ts

| # | Переменная | Проверка при старте | Файл:строка (чтение) | В compose | Что при отсутствии |
|---|---|---|---|---|---|
| 19 | `ENCRYPTION_KEY` | НЕТ ни в validate-env, ни в instrumentation | чтение: src/core/security/encryption.ts:74-76; бросок: encryption.ts:93-97 | да, `:?`-required (`docker-compose.yml:84,191`) | в проде бросает исключение при ПЕРВОМ шифровании/дешифровании, не на старте |
| 20 | `DATABASE_URL` | НЕТ в validate-env (там только `DATABASE_URL_POSTGRES`) | src/lib/db.ts:84-89 (бросок) | да (`docker-compose.yml:78,168`) | бросок при первом обращении к БД, не на старте; `src/lib/db.ts:87` |
| 21 | `REDIS_URL_CACHE` | НЕТ | src/lib/redis-cache.ts:45,137 | да (`docker-compose.yml:82,172`) | молчание; фолбэк на `REDIS_URL`/localhost |
| 22 | `ALERTMANAGER_WEBHOOK_TOKEN` | НЕТ | src/app/api/alerts/webhook/route.ts:80 | да (пустой дефолт, `docker-compose.yml:112`) | fail-closed 401 на вебхуке (молчаливая потеря алертов) |
| 23 | `METRICS_SCRAPE_TOKEN` | НЕТ | src/app/api/metrics/route.ts:40 | да (пустой дефолт, `docker-compose.yml:116`) | молчание; /api/metrics падает на session-авторизацию |
| 24 | `SENTRY_DSN` | НЕТ | src/workers/... (см. комментарий `docker-compose.yml:201-206`) | да (worker, пустой дефолт, `:206`) | молчание; ошибки воркеров не идут в Sentry |
| 25 | `AUTH_SECRET` | НЕТ | src/services/auth/session-service.ts:66; src/services/system/system-service.ts:22 | нет | альтернативный секрет сессии; при отсутствии обоих — бросок в проде (`session-service.ts:82`) |
| 26 | `PIN_LOOKUP_SECRET` | НЕТ в validate-env | есть только как build-стаб `Dockerfile:26` | нет в compose | НЕ ПРОВЕРЕНО, где читается в рантайме (грепом по `src` совпадений не найдено) |
| 27 | `TENANT_DOMAIN` | НЕТ | src/proxy.ts (см. `docker-compose.yml:99` не проброшен) | НЕТ | молчание; выделение тенанта из поддомена выключено |
| 28 | `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` | НЕТ | 2 совпадения в src | нет | молчание; влияние не проверялось (см. «Не проверено») |

## Прочее (не проверяется при старте, читается в рантайме)

- Числовые настройки воркеров (`WORKER_HEALTH_PORT`, `OUTBOX_INTERVAL_MS`, `PROJECTION_INTERVAL_MS`, `PDF_WORKER_CONCURRENCY` и др.) — валидируются не на старте, а при чтении: `src/workers/unified-worker/env-int.ts:19-44`, `config.ts:6-14`. Некорректное значение → откат к дефолту + `logger.warn`. Отдельной проверки «при старте» нет.
- `APP_VERSION` вшивается на сборке (`next.config.ts:21-23`); при отсутствии — `"unknown"`.
- Прод-контейнер: `docker-compose.prod.yml` добавляет только `HOSTNAME`, `NODE_OPTIONS=--max-old-space-size=512` (`:26-30`) и `SKIP_SEED` для migrate (`:144`). Полный набор переменных приходит из базового `docker-compose.yml`.

## Находки

| # | severity | path:line | Проблема | Почему важно | Предложить |
|---|---|---|---|---|---|
| F1 | критично | Dockerfile:119 vs package.json:10 | Контейнер стартует `node server.js`; `validate-env.ts` не вызывается | Обязательные секреты (условные для postgres, DEVICE_KEY_LOOKUP_SECRET) на проде заранее не проверяются; битая конфигурация проявляется в рантайме по частям | Вызвать `validateEnv()` из `src/instrumentation.ts` на старте (`register`, до старта воркеров) либо добавить валидатор в CMD образа |
| F2 | критично | src/../scripts/validate-env.ts (нет `ENCRYPTION_KEY`) vs docker-compose.yml:84,191 | `ENCRYPTION_KEY` обязателен в compose и бросает в проде (`encryption.ts:93-97`), но валидатором не проверяется | Падение откладывается до первого шифрования (токены Telegram и т.п.). На старте контейнер выглядит здоровым | Добавить `ENCRYPTION_KEY` в `ENV_CONFIG` (required в проде) |
| F3 | важно | scripts/validate-env.ts:66-75 | `POSTGRES_PASSWORD` помечен `required:false`, проверяется лишь «не заглушка» | Отсутствие обнаруживается только `:?`-подстановкой compose, а не валидатором; локальный `npm start` без него даёт невнятное поведение | Сделать required, когда `DATABASE_PROVIDER=postgres` |
| F4 | важно | src/instrumentation.ts:46-50 | Проверяется только НАЛИЧИЕ `SESSION_SECRET`, без длины/заглушки | Короткий или placeholder-секрет пройдёт старт, хотя `session-service.ts:68-69` бросает позже | Продублировать проверку длины из validate-env |
| F5 | важно | src/lib/db.ts:84-89 vs scripts/validate-env.ts (нет `DATABASE_URL`) | Код требует `DATABASE_URL` (или `DATABASE_URL_POSTGRES`), валидатор проверяет только вторую | В окружении с одним `DATABASE_URL` валидатор «зелёный», но реальная связка не проверена | Проверять `DATABASE_URL || DATABASE_URL_POSTGRES` |
| F6 | важно | scripts/validate-env.ts:129-153 | 4 прод-«тихих отказа» (TELEGRAM_API_BASE, TRUST_PROXY, DB_IDENTITY_ROLE, BACKUP_ENABLED) дают только warn и никогда не валят | Потеря уведомлений/алертов/входа по ПИН — «молчаливое выключение» функции на бою | Обязать их в проде (fail-fast) либо вывести в /api/health как degraded |
| F7 | важно | docker-compose.yml:82,172 vs src/lib/redis-cache.ts:45,137 | `REDIS_URL_CACHE` (отдельный инстанс кэша) читается кодом, но не проверяется валидатором | При отсутствии молчаливый фолбэк на state-Redis/localhost, что нарушает разделение кэш/state | Добавить в `ENV_CONFIG` (warn) |
| F8 | мелочь | scripts/validate-env.ts:23-32 vs src/lib/db.ts:40 | `DATABASE_PROVIDER` обязателен для валидатора, но код его игнорирует (всегда 'postgres') | Обязательность переменной не отражает поведение приложения | Убрать из required или использовать в коде |
| F9 | мелочь | Dockerfile:26 | `PIN_LOOKUP_SECRET` задан build-стабом, но в `src` не читается (совпадений нет) | Возможный рудимент; при этом имя есть только в сборочной стадии | Подтвердить назначение или удалить стаб (вне этой задачи) |
| F10 | мелочь | scripts/validate-env.ts:204-216 | Проверка `SENTRY_AUTH_TOKEN` читает `.env.sentry-build-plugin` через `require('node:fs')` | Работает, но смешивает env-валидацию с файловыми деталями сборки; на старте контейнера файла нет | Оставить как есть, но задокументировать, что это build-only проверка |

## Не проверено

- Фактические значения `.env*` не читались (запрет AGENTS §1) — выводы о «отсутствии» опираются на имена в коде и `:?`-подстановки compose, а не на реальное содержимое окружения прода.
- Не запускались `npm run build`/`validate-env` вживую: подтверждено статически, что скрипт вызывается только из npm-скриптов и `Dockerfile:119` его не содержит. Реальный вывод валидатора не снимался.
- `PIN_LOOKUP_SECRET` (F9): где читается в рантайме — не найдено; ГИПОТЕЗА, что рудимент. Поиск только по `src`/`scripts`, `.env*` исключены.
- `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_APP_URL` и `TENANT_DOMAIN`: влияние отсутствия не оценивалось (вне границ задачи «проверка при старте»).
- Полнота инвентаря `process.env.*`: собран по `src`/`scripts`/`next.config.ts`/`Dockerfile`; прочие каталоги (`e2e/`, `tests/`, `chaos/`) не сканировались — там возможны тестовые переменные, не влияющие на прод.
- Overlay `docker-compose.staging.yml` / `docker-compose.monitoring-*.yml` не сверялись: задача называет только `docker-compose.prod.yml`.
