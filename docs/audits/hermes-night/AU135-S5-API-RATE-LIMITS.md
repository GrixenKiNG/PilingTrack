# AU135-S5-API-RATE-LIMITS: Лимиты запросов по маршрутам

Версия: `git rev-parse HEAD` = **6aa2a49db73b8394eef36991df4be2bd04a272c8** (ветка `hermes/q4-0926`).
Только чтение; изменялся единственный файл — этот отчёт. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались как источник.

## Итог

Проверено 141 файл `route.ts` в `src/app/api` (найдено командой `find src/app/api -name route.ts | wc -l` = 141).
Собственный лимит частоты есть у `withMutation` (`src/core/api-wrapper.ts:170-171`): 100/мин на маршрут и 1800/мин на источник; у `withApi` лимита нет вообще.
Всего 10 находок: **критично 0, важно 5, мелочь 5**.

Топ-5:
1. `withApi` не ограничивает частоту — любой GET-маршрут без inline-лимита неограничен (важно; `src/core/api-wrapper.ts:62-147`).
2. Ветка статуса/скачивания задачи у `GET /api/reports/pdf` (jobId) не имеет лимита, хотя у `single-pdf` он есть (`pdf:job`, 60/мин) (важно; `src/app/api/reports/pdf/route.ts:207-233`).
3. Ключ пер-маршрутного лимита мутаций содержит `pathname` с динамическим id — ротация id даёт свежий бакет 100/мин (важно; `src/core/api-wrapper.ts:212`).
4. Без `TRUST_PROXY=true` ключ IP вырождается в `host-<host>` — один общий счётчик на весь домен для входа, мутаций и телеметрии (важно; `src/lib/rate-limiter.ts:499-505`, `docker-compose.yml:123`).
5. Отказ Redis на старте процесса → `redis=null` без повторов, лимиты навсегда уходят в память процесса (важно; `src/lib/rate-limiter.ts:117-156,184-192`).

## Методика

Команды и приёмы (воспроизводимо):
- `git rev-parse HEAD`, `git status --short` — версия и чистота дерева.
- `find src/app/api -name route.ts | sort` — полная инвентаризация маршрутов (144 файла).
- `search_files` (ripgrep) по `src` и `src/app/api`: `withApi|withMutation`, `= withMutation\(`, `rateLimit:\s*\{`, `RATE_LIMIT\s*[:=]`, `rateLimiter\.check`, `getRateLimitIdentifier`, `getTenantRateLimitIdentifier`, `createRateLimitMiddleware`, `AUTH_RATE_LIMIT|LOGIN_IP_RATE_LIMIT|ACCOUNT_LOCKOUT`, `TRUST_PROXY`, `RATE_LIMIT_BYPASS`.
- `find . -name middleware.ts` — глобального middleware нет (0 совпадений).
- Полные чтения: `src/lib/rate-limiter.ts` (515 стр.), `src/core/api-wrapper.ts` (223 стр.), `src/app/api/readiness/_shared/route-adapter.ts`, `src/services/auth/auth-service.ts:60-143`, `src/app/api/auth/login/route.ts`, `src/app/api/telemetry/{route,ingest/route,batch/route}.ts`, `src/app/api/reports/pdf/route.ts`, `src/app/api/reports/single-pdf/route.ts`, `src/app/api/pile-passports/export/route.ts`, `src/app/api/alerts/webhook/route.ts`, `src/app/api/feedback/stream/route.ts`, `src/app/api/ready/route.ts`, `src/app/api/metrics/route.ts`, `docker-compose.yml:115-129`, `scripts/validate-env.ts:120-153`.
- Тесты-«сторожа» (для понимания инвариантов, не как источник вердикта): `src/app/api/__tests__/route-guards.test.ts`, `src/app/api/telemetry/__tests__/rate-limit-key.test.ts`.
- Код приложения не запускался; числа лимитов взяты из констант в исходниках.

## Группы маршрутов и лимиты

Все маршруты проходят через `withApi` (внешний край), мутации — через `withMutation`, readiness-мутации — через `withReadinessCommand`, который вызывает `withMutation` (`src/app/api/readiness/_shared/route-adapter.ts:17`).

| Группа | Лимит | Ключ | файл:строка | Риск |
| --- | --- | --- | --- | --- |
| GET-маршруты через `withApi` без inline-лимита | **нет лимита** | — | `src/core/api-wrapper.ts:62-147` | важно: любой авторизованный GET неограничен |
| Мутации через `withMutation` (по умолчанию) | 100/мин на маршрут; отдельно 1800/мин на источник | `mut:<pathname>:<session-sha>:<ip>`; `mut:source:<ip>` | `src/core/api-wrapper.ts:170-171`, `:201`, `:212-213` | ключ содержит id в pathname (см. находку 3) |
| Мутации readiness (`withReadinessCommand` + override) | 10–30/мин (override) | `mut:<pathname>:<session-sha>:<ip>` | `src/app/api/readiness/defects/route.ts:81` (30); `.../readiness/handovers/[id]/accept/route.ts:21` (20); `.../readiness/shifts/[id]/start/route.ts:19` (20); `.../readiness/shifts/[id]/waiver/route.ts:27` (10); `.../readiness/defects/[id]/{reject,resolve,triage}/route.ts:23` (20); `.../readiness/work-permits/[id]/approve/route.ts:23` (20) | override по замыслу |
| `POST /api/telemetry` (ручной CSRF) | 1000/мин, блок 60 с | `telemetry:<ip>` | `src/app/api/telemetry/route.ts:43-47`, `:91-92` | ключ по IP (см. находку 4) |
| `POST /api/telemetry/batch` | 1000/мин, блок 60 с | `telemetry:<ip>` (общий с предыдущим) | `src/app/api/telemetry/batch/route.ts:28-32`, `:71-72` | намеренно общий порог (зафиксировано тестом) |
| `POST`/`PATCH /api/telemetry/ingest` | 500/мин, блок 300 с | `telemetry:ingest:<ip>` | `src/app/api/telemetry/ingest/route.ts:43-47`, `:102-103`, `:147-148` | в комментарии — «на устройство», по факту ключ по IP (находка 6) |
| `POST /api/auth/login` | ip 20/15мин(блок30мин); acct `<email>` 10/15мин(блок15мин); `<email>+ip` 5/15мин(блок30мин) | `login-ip:<id>`; `login-acct:<email>`; `login:<email>:<id>` | `src/services/auth/auth-service.ts:79`, `:91`, `:101`; конфиги `src/lib/rate-limiter.ts:19-44` | без `TRUST_PROXY` ключ IP общий (находка 4) |
| Синхронная выгрузка PDF (`reports/pdf` GET, `single-pdf` GET) | 20/5мин | `pdf:get:<userId>` | `src/app/api/reports/pdf/route.ts:26-30`, `:244`; `src/app/api/reports/single-pdf/route.ts:26-30`, `:242` | ключ по пользователю (осознанно) |
| Задача/скачивание PDF (`single-pdf` GET, action=status/download) | 60/мин | `pdf:job:<userId>` | `src/app/api/reports/single-pdf/route.ts:38-42`, `:201` | а у `reports/pdf` GET job-ветка без лимита (находка 2) |
| `GET /api/pile-passports/export` | 6/мин | `pile-export:get:<userId>` | `src/app/api/pile-passports/export/route.ts:28-32`, `:53` | ключ по пользователю |
| Без обёртки (нет лимита) | **нет лимита** | — | `src/app/api/health/route.ts:24`; `src/app/api/health/deep/route.ts:34`; `src/app/api/liveness/route.ts:13`; `src/app/api/ready/route.ts:27`; `src/app/api/readiness/route.ts`; `src/app/api/alerts/webhook/route.ts:88`; `src/app/api/feedback/stream/route.ts:9` | вход в webhook — секрет+constant-time; `/stream` — долгие соединения без капа (находка 8) |
| `POST /api/orion/lead` (замороженная зона) | собственный лимит по IP | — | `src/app/api/orion/lead/route.ts:34`, `:56` | не разбирался (ORION — заморожено) |

Поведение при недоступности Redis (единое для всех групп, `src/lib/rate-limiter.ts`):
- ограничения живут в Redis (Lua, `src/lib/rate-limiter.ts:47-93`); при ошибке выполнения — in-memory `Map`.
- `check()` при доступном Redis и ошибке в нём переводит `redisReady=false` и считает по памяти (`src/lib/rate-limiter.ts:184-192`, `:259-317`).
- если Redis недоступен уже на старте (`initRedis`), клиент не создаётся вовсе (`src/lib/rate-limiter.ts:151-155`) — без повторных попыток.
- `RATE_LIMIT_BYPASS=true` отключает все лимиты при `NODE_ENV !== 'production'` (`src/lib/rate-limiter.ts:177-182`).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/core/api-wrapper.ts:62-147` | `withApi` не вызывает `rateLimiter.check` — GET-маршруты без inline-лимита не ограничены частотой | Любой авторизованный GET неограничен: дорогие чтения (`admin/analytics/overview`, `admin/equipment-analytics`, `reports/export` — сборка .xlsx/csv в памяти, `media/download-batch`). Один клиент может занимать процесс/БД бесконечно; в коде это уже признано для выгрузки свай (комментарий в `src/app/api/pile-passports/export/route.ts:20-26`) | Ввести общий лимит на GET в `withApi` (например, 300/мин по пользователю для дорогих доменов) либо пометить дорогие GET опцией `rateLimit` |
| 2 | важно | `src/app/api/reports/pdf/route.ts:207-233` | Ветка `jobId`+`action=status/download` у `GET /api/reports/pdf` не проверяет лимит | У `single-pdf` эта же ветка ограничена `pdf:job` 60/мин (`src/app/api/reports/single-pdf/route.ts:200-207`), здесь — нет. Опрос статуса задачи ⇒ неограниченные запросы к очереди BullMQ и к файлам выгрузок | Добавить `rateLimiter.check('pdf:job:<userId>', PDF_JOB_RATE_LIMIT)` в job-ветку `reports/pdf` GET (как в single-pdf) |
| 3 | важно | `src/core/api-wrapper.ts:212` | Ключ мутаций = `mut:${request.nextUrl.pathname}:<session>:<ip>`, а `pathname` включает динамический id | `DELETE /api/equipment/<id1>`, `<id2>`, … дают каждый свой бакет 100/мин. Реально массовые операции по разным id ограничивает только источник-кап 1800/мин (а он общий/IP, см. #4). Перечисление/удаление по множеству id идёт быстрее задуманного | Ключевать по шаблону маршрута (не по конкретному id), напр. нормализовать сегмент `[id]`, сохранив пер-источник кап |
| 4 | важно | `src/lib/rate-limiter.ts:499-505` | Без `TRUST_PROXY==='true'` `getRateLimitIdentifier` возвращает `host-<host>` — один бакет на всё развёртывание | Единый ключ ломает: `login-ip:` (20/15мин на весь домен ⇒ блокировка входа всем на 30 мин), `mut:source:` (1800/мин глобально), телеметрию. `docker-compose.yml:123` задаёт `${TRUST_PROXY:-}` (по умолчанию пусто), `scripts/validate-env.ts:133-136` лишь предупреждает | Обязать `TRUST_PROXY` в проде (fail-fast сборки) либо явно документировать как требуемое; при пустом значении делать IP-ключ недоступным, а не общий |
| 5 | важно | `src/lib/rate-limiter.ts:117-156` | Отказ Redis на старте: `initRedis` при исключении ставит `this.redis=null` и больше не инициализирует клиент | Процесс до конца жизни считает лимиты по in-memory `Map` (`:259-317`), которая не разделяется между репликами и сбрасывается при рестарте. Защита от перебора тихо слабеет; при нескольких репликах реальный порог умножается на их число | Повторять инициализацию Redis (retry/backoff) или отдавать health `degraded`, если лимитер работает из памяти |
| 6 | мелочь | `src/app/api/telemetry/ingest/route.ts:43-46`, `:102` | Комментарий «per device / 500 per device», но ключ `telemetry:ingest:<ip>` строится по IP, а не по ключу устройства | Устройства за одним шлюзом/NAT делят 500/мин и общий 5-мин блок — легитимный парк телеметрии глушится вместе | Ключевать по `x-device-key`-идентичности (после аутентификации) либо явно описать, что лимит по IP |
| 7 | мелочь | `src/lib/rate-limiter.ts:511-515` | `getTenantRateLimitIdentifier` ключуется клиентским заголовком `x-tenant-id` | Ротация заголовка даёт неограниченные бакеты — обход лимита. Сейчас в приложении не используется (потребителей нет, только определение и тесты), т.е. латентная ловушка | Удалить или задокументировать как непригодную для защиты; не подставлять клиентские заголовки в ключ |
| 8 | мелочь | `src/app/api/alerts/webhook/route.ts:88`; `src/app/api/feedback/stream/route.ts:9` | Маршруты без обёртки и без лимита: webhook Alertmanager и SSE‑поток обратной связи | Webhook защищён секретом с constant-time (`:79-86`), но частотой не ограничен: валидный флуд обрабатывается `MAX_FORWARDED=100` на запрос, число запросов не ограничено. `/stream` держит долгое соединение и `setInterval` на клиента без капа — исчерпание соединений/таймеров процессом | Добавить отдельный лимит по IP/токену для webhook и кап числа одновременных `/stream` на пользователя |
| 9 | мелочь | `src/lib/rate-limiter.ts:177-182` | `RATE_LIMIT_BYPASS=true` отключает все лимиты всюду, где `NODE_ENV !== 'production'` | При неверно выставленном `NODE_ENV` (например, `Production`, `prod`, или не задан) флаг остаётся активным и снимает всю защиту от перебора | Привязать обход к явному тестовому признаку (`NODE_ENV==='test'` / отдельный E2E-флаг), а не к «не production» |
| 10 | мелочь | `src/lib/rate-limiter.ts:467-471` | `createRateLimitMiddleware` экспортируется, но не используется ни одним маршрутом | Мёртвый API: читатель может принять его за действующую точку лимитирования | Удалить или реализовать через него общий лимит GET (см. #1) |

## Не проверено

- Значения боевого окружения (`TRUST_PROXY`, `NODE_ENV`, `RATE_LIMIT_BYPASS`, `REDIS_URL`) — `.env*` читать запрещено правилами. Выводы #4 и #9 опираются только на код и `docker-compose.yml:115-129`; реальное состояние прода «не проверено».
- Число реплик приложения на бою (влияет на силу in-memory фолбэка, #5) — в репозитории не подтверждено; живых запросов не делал.
- Фактическое поведение Redis/ioredis при повторном подключении по событиям (`ready`/`error`) — читал код, но не запускал; переоткрытие лимита после восстановления Redis «не проверено».
- Расчёт «дорогих» GET как DoS-вектора — оценка по коду; нагрузочного прогона не было.
- Замороженные зоны (варианты экрана оператора, ORION) в объём не входили, кроме факта наличия лимита у `orion/lead`.
- Динамическая проверка 429/Retry-After на реальном приложении не выполнялась (только чтение кода и тестов-сторожей).
