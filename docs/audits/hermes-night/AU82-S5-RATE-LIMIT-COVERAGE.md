# AU82-S5-RATE-LIMIT-COVERAGE: какие маршруты ограничены по частоте, а какие нет

Версия рабочей папки: `git rev-parse HEAD` = `ccdbd4daffaa820672332f86bda31b7205ae6cbd`
(ветка `hermes/q4-0926`, один изменённый файл в дереве — `AGENTS.md`).

Статусы в отчёте: ПРОЙДЕНО — проверено по коду/команде; ГИПОТЕЗА — вывод, не подтверждённый запуском; НЕ ПРОВЕРЕНО — не смотрел или среда не дала.

## Итог

- Аудит чтения кода: **0 критично, 8 важно, 7 мелочей** (всего 15 находок).
- Главный вывод: **`withApi` не применяет лимит частоты вообще.** Лимит живёт только в `withMutation` (CSRF + POST/PUT/DELETE). Все **87** GET-обработчиков идут через `withApi` (`src/app/api`, команда: 87 из 87) — то есть **ни один GET-маршрут не ограничен обёрткой**.
- Собственный лимит есть лишь у трёх GET-файлов: `reports/pdf`, `reports/single-pdf`, `pile-passports/export`; плюс публичный POST `orion/lead`. Вход `auth/login` и телеметрия закрыты своими лимитерами внутри обработчиков. Всего `rateLimiter.check` встречается в 7 файлах `src/app/api/**/route.ts`.
- Тяжёлые и публичные маршруты **без** собственного лимита: `reports/export`, `readiness/export`, `alerts/webhook`, `health/deep`, `media/download-batch` (подробности в «Находки»).
- Поведение при недоступности Redis: **не fail-open и не fail-closed, а «деградация в память процесса»** — `check()` ловит ошибку Redis и считает лимит по локальной `Map` (`src/lib/rate-limiter.ts:184-192`, `:259`). В одном процессе лимит держится, но не разделяется между процессами/репликами и сбрасывается при рестарте. `RATE_LIMIT_BYPASS=true` действует **только вне продакшена** (`:177-182`) — в бою игнорируется.

## Методика

Что и как искал (чтобы повторить):

1. Инвентарь маршрутов: `find src/app/api -name 'route.ts' | sort` → **141** файл.
2. Обёртки: `search_files` по `withMutation|withApi` в `src/app/api`; AST-проверки в
   `src/app/api/__tests__/route-guards.test.ts` и `api-routes.test.ts` (там же формально
   зафиксирован разрыв: «лимит обёртки … к маршруту не применяется», `api-routes.test.ts:226-237`).
3. Собственные лимитеры: `grep -rn 'rateLimiter.check' src/` — найдено 7 файлов маршрутов;
   `grep -rn 'rateLimit:' src/app/api` — 8 переопределений (все на `withReadinessCommand`).
4. Публичные/без обёртки: цикл по файлам без `withApi|withMutation` → 21 файл (8 публичных
   из `NO_WRAPPER_METHODS`/`PUBLIC_GETS` в тестах, 13 readiness-мутаций через
   `withReadinessCommand` → внутри `withMutation`, `src/app/api/readiness/_shared/route-adapter.ts:17`).
5. GET-обработчики: `grep -rl 'export const GET = withApi'` → 87; сравнение с числом `export const GET` → 87.
6. Ключи лимитов: чтение `src/lib/rate-limiter.ts` (ключи IP/host, `TRUST_PROXY`, `getRateLimitIdentifier`), `src/core/api-wrapper.ts` (ключи мутаций), `src/services/auth/auth-service.ts` (ключи входа).
7. Публичные пробы и экспозиция токенов: `health`, `health/deep`, `liveness`, `ready`, `readiness`, `metrics`, `alerts/webhook`, `system/status`.
8. `middleware.ts` отсутствует (find по репозиторию — не найден), то есть отдельного
   глобального rate-limit слоя поверх маршрутов нет.

Семантика обёрток (общая для всех маршрутов):

| Обёртка | Лимит обёртки | Ключ | Метод/назначение |
| --- | --- | --- | --- |
| `withApi` (`src/core/api-wrapper.ts:62`) | **нет** | — | любой метод, чаще GET |
| `withMutation` (`:178`) | общий `mut:source:<ip>` 1800/мин (`:171`,`:201`) + по-маршрутный `mut:<path>:<sessionSha>:<ip>` 100/мин (`:170`,`:212-213`) | IP (или host), sha256-префикс сессии | POST/PUT/DELETE, CSRF внутри |
| `withReadinessCommand` (`readiness/_shared/route-adapter.ts:17`) | = `withMutation`; опция `rateLimit` переопределяет | как выше | readiness-мутации |

Ключ `getRateLimitIdentifier` (`src/lib/rate-limiter.ts:499-505`): при `TRUST_PROXY=true` —
`x-forwarded-for`/`x-real-ip`; иначе `host-<host>` (общая корзина на домен).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/core/api-wrapper.ts:62` (rateLimit читается только на `:213`) | `withApi` не применяет лимит ни при каких опциях; `ApiWrapperOptions.rateLimit` (`:17-23`) сюда не доходит. Все 87 GET-обработчиков не ограничены | любой аутентифицированный пользователь (или публичный GET) дёргает тяжёлый GET без предела; brute-force/нагрузка на чтения не сдерживается | дать `withApi` общий лимит (напр. per-user/per-IP `withRead`) либо общий nginx/прокси-лимит на GET |
| 2 | важно | `src/app/api/reports/export/route.ts:18` | выгрузка csv/xlsx (окно до 92 дней, `:12`) через `withApi`, **без** собственного лимита | цикл выгрузок загружает процесс сборкой файла в памяти; у `pile-passports/export` аналогичный лимит есть (`:53`), здесь — нет | `rateLimiter.check(\`reports-export:get:${user.id}\`, …)`, ключ — пользователь |
| 3 | важно | `src/app/api/readiness/export/route.ts:12`,`:177` | выгрузка CSV всех наборов (в т.ч. `audit` — чтение всей цепочки, `:81`) через `withApi`, без лимита | тяжёлое чтение + запись аудита на каждый запрос, без предела частоты | лимит по пользователю, как в PDF/журнале забивки |
| 4 | важно | `src/app/api/alerts/webhook/route.ts:88` | публичный POST, защищён общим секретом (`:79-86`), но **лимита частоты нет**; ограничен только `MAX_FORWARDED=100` на запрос (`:60`) | секрет перебирается без счётчика (сравнение по времени, но не по частоте); при утечке токена — флуд Telegram по 100 сообщений/запрос | `rateLimiter.check` по IP **до** `isAuthorized` |
| 5 | важно | `src/app/api/health/deep/route.ts:34` | публичная проба зависимостей, до 8 обращений к БД/Redis/S3, без лимита (только 30-с кэш, `:32`) | неаутентифицированный DoS-вектор: частые запросы при протухшем кэше заставляют перепроверять все зависимости | лимит по IP перед `getFreshStatus()` |
| 6 | важно | `src/app/api/media/download-batch/route.ts:31` | до 100 подписанных URL за запрос (`HeadObjectCommand`+`getSignedUrl` на каждую, `:86-100`) через `withApi`, без лимита | один цикл запросов генерирует тысячи подписей и обращений к S3 | лимит по пользователю (напр. 30/мин) |
| 7 | важно | `src/core/api-wrapper.ts:196` + `src/lib/rate-limiter.ts:479` | при `TRUST_PROXY≠true` ключ = `host-<host>` (`:504`), поэтому `mut:source:<ip>` — **одна корзина на всех**; общий 1800/мин закрывает сразу весь завод; `scripts/validate-env.ts:133-136` это лишь предупреждает | за NAT/без прокси общий лимит мутаций один для всех пользователей — сосед может исчерпать бюджет | требовать `TRUST_PROXY=true`, когда порт закрыт снаружи; или считать IP из транспорта, а не из заголовка |
| 8 | важно | `src/lib/rate-limiter.ts:184-192`,`:259` | при сбое Redis лимит деградирует в локальную `Map`: не разделяется между процессами/репликами и теряется при рестарте | brute-force входа/мутаций может молча ослабнуть (лимит × число процессов) без алерта | вынести факт перехода на in-memory в лог/метрику; для auth ужесточить (fail-closed при недоступности Redis) |
| 9 | мелочь | `src/lib/rate-limiter.ts:511-515` | `getTenantRateLimitIdentifier` мёртв (только тесты `src/lib/__tests__/rate-limiter.test.ts:252-263`), а ключ берётся из **клиентского** `x-tenant-id` | если его начнут использовать, лимит обходится ротацией заголовка — та же ошибка, что уже закрыта для `getRateLimitIdentifier` | удалить либо запретить использование клиентского заголовка в ключе |
| 10 | мелочь | `src/core/api-wrapper.ts:17-23` vs `:213` | `ApiWrapperOptions.rateLimit` документирован как override, но `withApi` его игнорирует (применяется только в `withMutation`) | передача `{ rateLimit }` в `withApi` молча не даст эффекта (сейчас так никто не делает — `grep 'rateLimit:'` даёт только readiness) | либо реализовать в `withApi`, либо явно задокументировать «только для withMutation» |
| 11 | мелочь | `src/app/api/metrics/route.ts:47` | токен-защищённый GET (`METRICS_SCRAPE_TOKEN`, `:39-45`) без лимита частоты | `METRICS_SCRAPE_TOKEN` перебирается без счётчика | лимит по IP при провале токена |
| 12 | мелочь | `src/app/api/health/route.ts:24`, `src/app/api/liveness/route.ts:13`, `src/app/api/ready/route.ts:27`, `src/app/api/readiness/route.ts:26` | публичные пробы без лимита; отдают `version`/`uptime` | фингерпринт версии + неограниченная нагрузка | общий лимит по IP на пробы |
| 13 | мелочь | `src/app/api/weather/route.ts:40` | внешний вызов (Open-Meteo) через `withApi` без собственного лимита | смягчено Redis-кэшем 15 мин и предохранителем, но per-запрос лимита нет | лимит по пользователю |
| 14 | мелочь | `src/app/api/system/status/route.ts:36` | `?fresh=true` форсирует свежую проверку (8 проб) без лимита (за админ-гейтом `system.read`) | админ может молотить свежими проверками зависимости | лимит на `fresh=true` |
| 15 | мелочь | `src/app/api/admin/dlq/route.ts:51` | GET до 500 записей + `db.report.findMany` (`:35`), без собственного лимита | нагрузка при частых обращениях (за `dlq.manage`) | лимит по пользователю |

Маршруты с собственным лимитом (для сверки, значения из кода):

| Маршрут | Метод | Общий лимит обёртки | Собственный лимит | Ключ | Redis недоступен |
| --- | --- | --- | --- | --- | --- |
| `/api/auth/login` (`route.ts:17`) | POST | нет (`withApi`) | `login-ip` 20/15мин, `login-acct` 10/15мин, `login:<email>:<ip>` 5/15мин (`auth-service.ts:79,91,101`) | IP; email; email+IP | деградация в память |
| `/api/orion/lead` (`route.ts:56`) | POST | нет (ручной) | `LEAD_RATE_LIMIT` 5/10мин (`:34`) | IP/host | деградация в память |
| `/api/telemetry` (`route.ts:92`) | POST | нет (`withApi`; исключение в тестах) | `telemetry:<ip>` 1000/мин (`:43`) | IP | деградация |
| `/api/telemetry/batch` (`batch/route.ts:72`) | POST | нет (`withApi`) | `telemetry:<ip>` 1000/мин (`:28`) | IP | деградация |
| `/api/telemetry/ingest` (`ingest/route.ts:103,148`) | POST/PATCH | нет (`withApi`) | `telemetry:ingest:<ip>` 500/мин (`:43`) | IP (контроллер) | деградация |
| `/api/reports/pdf` (`pdf/route.ts:244`) | GET(sync) | нет (`withApi`) | `pdf:get:<userId>` 20/5мин (`:26`) | пользователь | деградация |
| `/api/reports/single-pdf` (`single-pdf/route.ts:201,242`) | GET(sync/job) | нет (`withApi`) | `pdf:get:<userId>` 20/5мин; `pdf:job:<userId>` 60/мин (`:26,38`) | пользователь | деградация |
| `/api/pile-passports/export` (`export/route.ts:53`) | GET | нет (`withApi`) | 6/мин (`:28`) | пользователь | деградация |
| readiness-мутации (`defects`, `shifts`, `handovers`, `work-permits`) | POST/PATCH/PUT/DELETE | есть (`withMutation` 100/мин + source 1800/мин) | override 10-30/мин в 8 файлах (напр. `defects/route.ts:81`, `shifts/[id]/waiver/route.ts:27`) | маршрут+сессия+IP | деградация |

Приложение (остальные тяжёлые read-эндпоинты без собственного лимита, `path:line`):
`src/app/api/readiness/audit/route.ts:54`,
`src/app/api/readiness/history/route.ts:74`,
`src/app/api/readiness/current/route.ts:62`,
`src/app/api/admin/analytics/overview/route.ts:152`,
`src/app/api/telemetry/route.ts:240`,
`src/app/api/media/[id]/download/route.ts:9`,
`src/app/api/user-documents/control/route.ts:15`,
`src/app/api/pile-passports/route.ts:28`.

## Не проверено

- Список выше по «полноте 141 маршрута» собран по AST-инвентарю тестов и grep; полную
  построчную таблицу по всем 141 файлам я не выводил — большинство попадает под правило
  «GET/`withApi` → лимита нет», «мутация/`withMutation` → 100/мин + source 1800/мин».
- Не запускал приложение и не мерил фактические 429/Retry-After (read-only; не проверено эмпирически).
- Значение `TRUST_PROXY` и `RATE_LIMIT_BYPASS` в боевом окружении не смотрел (`.env` читать запрещено).
  Что именно задано на проде — НЕ ПРОВЕРЕНО.
- Не проверял наличие внешнего (nginx/Caddy/прокси) лимита перед приложением — в репозитории
  конфигурации такого слоя не искал за пределами `docker-compose.yml`/`middleware.ts`.
- Гонки/атомарность Lua-скрипта лимитера (`src/lib/rate-limiter.ts:47-93`) не тестировал.
- Ветку `compare` с `main` и изменения после `ccdbd4d` не анализировал (задача — срез по коду HEAD).
