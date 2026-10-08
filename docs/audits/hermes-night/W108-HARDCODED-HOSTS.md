# W108-HARDCODED-HOSTS: адреса серверов и доменов, записанные прямо в коде

Только чтение. Область: `src/` и `scripts/` (без `node_modules`). Проверено 2026-10-08,
ветка `hermes/q4-0926` (worktree `D:\PillingR\wt-night`).

## Итог

- Всего находок: 16, из них критично — 0, важно — 7, мелочь — 9.
- В рабочем коде (`src/`, исполняется в бою) боевой IP сервера НЕ встречается вообще:
  все IP в `src/` — тестовые (`203.0.113.x`, `10.0.0.x`) или `127.0.0.1`.
- Боевой домен `orionpiling.ru` в `src/` есть ровно в двух местах, оба с env-обёрткой
  `NEXT_PUBLIC_SITE_URL` (дефолт боевой): `src/app/sitemap.ts:10` и
  `src/app/orion/page.tsx:10,12` (второй — замороженная зона ORION).
- Главная группа риска — скрипты деплоя/обслуживания: там боевой IP `87.242.102.125`
  и домен `orionpiling.ru` записаны жёстко, часть вообще без переменной окружения.
- Топ-5 по важности:
  1. `scripts/refresh-prod-snapshot.sh:13` — боевой IP жёстко, без env (перенос сервера = правка кода).
  2. `scripts/prod-audit-readonly.sh:18` — `DOMAIN="orionpiling.ru"` жёстко, без env.
  3. `scripts/deploy-prod.sh:24` — боевой IP в боевом дефолте `${DEPLOY_HOST:-user1@87.242.102.125}`.
  4. `src/app/sitemap.ts:10` — боевой домен в дефолте `NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru'` (высокий приоритет, `src/app/`).
  5. `scripts/staging-local.sh:37` — тот же боевой IP в дефолте `DEPLOY_HOST`.

## Методика

Поиск по репозиторию (ripgrep через `search_files`), отдельно по `src/` и `scripts/`:
- `orionpiling` — домен (79 совпадений по репо, из них в области 15).
- `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` — IPv4; отфильтрованы `127.0.0.1` и `0.0.0.0`.
- `https?://` — абсолютные URL; исключены `localhost`, `example.com`, `github.com`,
  `npmjs.org`, публичные CDN и XML-пространства имён (`schema.org`, `openxmlformats.org`, `w3.org`).
- `\bhttps?://[a-zA-Z0-9.-]+` и `[a-z0-9.-]+\.(ru|com|net|org|io|...)` — только не-тестовые файлы.
- Дополнительно проверены: `SENTRY_DSN|sentry.client`, `dsn|SENTRY|ingest\.`, `NEXT_PUBLIC_SITE_URL|BASE_URL`,
  `87\.242\.102\.125` по всему репо. Файлы `__tests__` помечены как тестовые и в таблицу
  вынесены сводно.

Каждое найденное место открыто и прочитано (`read_file`), номера строк — из прочитанного файла.

## Находки

Приоритет: П1 — `src/app/`, `src/services/`, `src/core/` (рабочий код); П2 — `scripts/`.

| # | severity | path:line | что найдено | тип адреса | вынести в env? | проблема / сценарий / предлагаемая правка |
|---|----------|-----------|-------------|------------|----------------|-------------------------------------------|
| 1 | важно | `src/app/sitemap.ts:10` | `NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru'` | боевой домен | уже env, дефолт боевой | **П1.** При переносе на новый домен, если `NEXT_PUBLIC_SITE_URL` не задан, `sitemap.xml` укажет старый домен: поисковики пойдут на мёртвый адрес. Правка: дефолт `''`/`http://localhost:3000` или явный fallback из `APP_URL`. |
| 2 | мелочь | `src/services/weather/weather-client.ts:82` | `WEATHER_API_BASE?.replace(...) ?? 'https://api.open-meteo.com'` | публичный внешний сервис | уже env-var-able | **П1.** Внешний публичный API погоды, адрес уже читается из `WEATHER_API_BASE`; дефолт безопасен. Правка не требуется. |
| 3 | мелочь | `src/core/notifications/telegram.ts:227,265,397` | `${process.env.TELEGRAM_API_BASE \|\| 'https://api.telegram.org'}` | публичный внешний сервис | уже env-var-able | Публичный API Telegram; адрес уже выносится через `TELEGRAM_API_BASE` (в комментарии к `weather-client.ts:16` объяснено, зачем). Правка не требуется. |
| 4 | мелочь | `src/instrumentation-client.ts:8` | `dsn: "https://…@o4511443929530368.ingest.de.sentry.io/4511443960332368"` | публичный (Sentry SaaS) | да, `NEXT_PUBLIC_SENTRY_DSN` | DSN Sentry зашит в клиентский бандл константой. Серверный путь (`src/workers/unified-worker/sentry.ts:24,31`) берёт DSN из `SENTRY_DSN`, а клиент — нет: при смене Sentry-проекта нужна пересборка, и адрес виден в бандле. Правка: читать из `process.env.NEXT_PUBLIC_SENTRY_DSN`. (Тот же DSN жёстко лежит в корневых `sentry.server.config.ts:8` и `sentry.edge.config.ts:9` — вне области `src/`, см. «Не проверено».) |
| 5 | мелочь | `src/app/orion/page.tsx:10,12` | `NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru'` | боевой домен | уже env, дефолт боевой | Замороженная зона ORION — не трогать (AGENTS.md §1). Фиксация факта; та же схема, что и в `sitemap.ts`. |
| 6 | важно | `scripts/refresh-prod-snapshot.sh:13` | `SSH_HOST="87.242.102.125"` (+ `:11` `SSH_KEY="$HOME/.ssh/orionpiling"`) | боевой IP | нет — жёстко | **П2.** Боевой IP сервера зашит константой без переменной окружения. При смене адреса скрипт качает снапшот в никуда. Правка: `SSH_HOST="${DEPLOY_HOST:-}"` (без боевого дефолта) или аргумент. |
| 7 | важно | `scripts/prod-audit-readonly.sh:18` | `DOMAIN="orionpiling.ru"` | боевой домен | нет — жёстко | **П2.** Боевой домен зашит константой, хотя `:86` уже использует `https://$DOMAIN/...`. Правка: `DOMAIN="${PROD_DOMAIN:-}"`. Комментарии `:9,12,13` содержат IP `87.242.102.125` (см. #12). |
| 8 | важно | `scripts/deploy-prod.sh:24` | `HOST="${DEPLOY_HOST:-user1@87.242.102.125}"` | боевой IP | да — env `DEPLOY_HOST`, дефолт боевой | **П2.** env есть, но боевой IP стоит дефолтом: запуск без переменной молча уйдёт на прод-адрес. Правка: убрать боевой дефолт (fail, если `DEPLOY_HOST` не задан). |
| 9 | важно | `scripts/deploy-prod.sh:133,134` | `curl -s https://orionpiling.ru/api/health` / `.../deep` | боевой домен | нет — в теле heredoc | **П2.** Проверка здоровья после выката ходит на зашитый домен; при переносе домена покажет ложный провал. Правка: подставлять домен из `$HOST`/env. (`:25` `KEY="$HOME/.ssh/orionpiling"` — имя ключа, не адрес.) |
| 10 | важно | `scripts/staging-local.sh:37` | `HOST="${DEPLOY_HOST:-user1@87.242.102.125}"` | боевой IP | да — env `DEPLOY_HOST`, дефолт боевой | **П2.** То же, что #8: боевой IP дефолтом. Правка: убрать боевой дефолт. (`:38` — имя ключа `orionpiling`, не адрес.) |
| 11 | важно | `scripts/prod-smoke.mjs:29` | `argValue('url', 'https://orionpiling.ru')` | боевой домен | да — аргумент/`--url`, дефолт боевой | **П2.** Боевой домен дефолтом; запуск без `--url` бьёт по проду. Приемлемо для smoke-скрипта, но лучше дефолт без боевого адреса. |
| 12 | мелочь | `scripts/prod-audit-readonly.sh:9,12,13` | `user1@87.242.102.125` в примерах-комментариях | боевой IP | да | Это комментарии с примерами запуска (не исполняются), но выдают боевой адрес. Правка: заменить на плейсхолдер `<user@host>`. |
| 13 | мелочь | `scripts/app-guard.sh:75,138` | `TG_API_BASE="${TG_API_BASE:-https://api.telegram.org}"` | публичный внешний сервис | уже env-var-able | Публичный API Telegram с env-обёрткой. Правка не требуется. |
| 14 | мелочь | `scripts/backup.sh:31` | `S3_ENDPOINT="${S3_ENDPOINT:-}"` (пример `https://storage.yandexcloud.net`) | публичный/конфигурируемый | уже env-var-able | Адрес S3 уже из переменной, дефолт пустой. Правка не требуется. |
| 15 | мелочь | `scripts/verify-orion-equipment-pdfs.py:26-39` | внешние URL-источники (diesekogroup, liebherr, gruzovik, exkavator, ecanet) | публичные ссылки | нет нужды | Ссылки на внешние сайты-источники оборудования, не адреса нашего сервера. Правка не требуется. |
| 16 | мелочь | `src/lib/__tests__/csrf-protection.test.ts`, `rate-limiter.test.ts:186`, `src/services/auth/__tests__/*`, `src/app/api/*/__tests__/*`, `scripts/*-test*.js/cjs` | `app.orionpiling.ru`, `orionpiling.ru`, `203.0.113.x`, `10.0.0.x`, `127.0.0.1`, `localhost` | тестовые | нет | Фикстуры тестов и тестовые стенды (диапазон `203.0.113.0/24` — документационный). В прод не попадают. Сводно, отдельные строки не разворачиваю. |

### Сводка по файлам (область src/ + scripts/)

- `src/app/sitemap.ts` — 1 боевой домен (env есть) — важно.
- `src/app/orion/page.tsx` — 2 боевых домена (env есть) — заморозка ORION.
- `src/core/notifications/telegram.ts` — 3 публичных URL (env есть) — мелочь.
- `src/services/weather/weather-client.ts` — 1 публичный URL (env есть) — мелочь.
- `src/instrumentation-client.ts` — 1 Sentry DSN жёстко — мелочь.
- `scripts/deploy-prod.sh` — боевой IP (env, дефолт боевой) ×1, боевой домен ×2 — важно.
- `scripts/staging-local.sh` — боевой IP (env, дефолт боевой) ×1 — важно.
- `scripts/refresh-prod-snapshot.sh` — боевой IP жёстко ×1 — важно.
- `scripts/prod-audit-readonly.sh` — боевой домен жёстко ×1, боевой IP в комментариях ×3 — важно/мелочь.
- `scripts/prod-smoke.mjs` — боевой домен дефолтом ×1 — важно.
- `scripts/app-guard.sh`, `scripts/backup.sh` — публичные/конфигурируемые — мелочь.
- Остальные IP в `scripts/` — `127.0.0.1`/`0.0.0.0` (локальные стенды, K8s port-forward) — не находки.

## Не проверено

- **Реальные значения переменных окружения** (`NEXT_PUBLIC_SITE_URL`, `DEPLOY_HOST`,
  `WEATHER_API_BASE`, `TELEGRAM_API_BASE`, `SENTRY_DSN`) на проде и в CI: читать `.env*`
  запрещено (AGENTS.md §1). Отсюда неизвестно, заданы ли они фактически — риск «дефолт
  сработал» из оценки не убирается.
- **Корневые Sentry-конфиги вне области `src/`**: `sentry.server.config.ts:8` и
  `sentry.edge.config.ts:9` содержат тот же жёсткий DSN. Формально вне `src/`/`scripts/`
  (корень проекта), поэтому в таблицу как отдельные находки не включены, но входят в
  ту же проблему, что и #4.
- **Конфиги деплоя вне области**: `deploy/Caddyfile.prod:23,69,70`,
  `docker-compose.monitoring-prod.yml:62,129`, `Dockerfile*`, `docker-compose*.yml` —
  содержат `orionpiling.ru`/`orionpiling.online` и внутренние имена сервисов
  (`pgbouncer:5432`, `postgres:5432`). Вне заданной области (`src/`, `scripts/`), не разбирались.
- **`load-tests/`, `tests/`, `e2e/`, `.github/workflows/`** — вне области задания;
  поверхностно видны дефолты `http://localhost:3000` (публично-безопасны), но полную
  опись не делал.
- **Значения IP `87.242.102.125` в `docs/`, `reports/`, `RELEASE.md`** — документация,
  вне области; найдены, но не вынесены в «Находки».
- **`validate-env.ts`** — проверяет ли он `NEXT_PUBLIC_SITE_URL`/`DEPLOY_HOST`, не
  разбирал построчно (видел только комментарий про погоду, `scripts/validate-env.ts:109`).
