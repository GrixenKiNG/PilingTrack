# Независимый production-аудит PilingTrack

**Дата среза:** 2 июля 2026  
**Объект:** локальный репозиторий `PilingTrack` и реально работающий production `orionpiling.ru`  
**Метод:** code review, GitNexus-граф, сборка и тесты, анализ Docker/Compose, read-only SSH-диагностика VM и контейнеров, SQL-проверки, production HTTP/TLS/WebSocket probes, desktop/mobile UI-проверка.

## Вердикт

**Итоговая оценка: 5.8/10.**

Production функционирует: сайт и БД доступны, контейнеры не перезапускаются, TLS и security headers настроены хорошо, сборка и 1413 автоматических тестов проходят, production-зависимости не имеют известных npm-уязвимостей. Это не аварийный или фиктивный продукт.

Но текущую систему нельзя честно назвать готовой к заявленной нагрузке 100+ одновременных пользователей, настоящему multi-tenant режиму или строгим требованиям по восстановлению данных. Главная системная проблема — **ложное ощущение здоровья**: health endpoints и deploy gate остаются зелёными, когда недельная аналитика падает, а WebSocket heartbeat/metrics не записываются.

**Critical: 0 · High: 7 · Medium: 10 · Low: 4**

Отсутствие Critical — сознательная калибровка, а не мягкость. В текущем single-tenant production не найден подтверждённый удалённый auth bypass, публичная утечка секрета или активная потеря основных отчётов. Несколько High становятся Critical только при включении multi-tenant либо при реальном инциденте восстановления.

## Что реально проверено

- `npm run build` — успешно, Next.js 16.2.6, TypeScript успешно, 69 статических страниц.
- Lint и text-integrity — успешно.
- Unit: **1271/1271**; contract: **35/35**; integration: **107/107**.
- `npm audit --omit=dev` — **0 известных уязвимостей**.
- Production `/`, `/login`, `/api/health`, `/api/health/deep`, WebSocket upgrade, TLS и headers.
- Production VM: Docker, ресурсы, firewall, volumes, процессы, логи, timers, backup-файлы, git drift.
- Production PostgreSQL: подключения, размеры, миграции, архивирование WAL и актуальность аналитических проекций.
- Desktop 1440×900 и mobile 390×844 login page: overflow, размеры элементов, accessibility attributes, сетевые запросы и визуальный снимок.

Ограничения: полноценный авторизованный E2E всех ролей не выполнялся — аудит не использовал пользовательские пароли и не изменял production-данные. GitNexus PDG/taint-слой не был доступен, поэтому выводы по security основаны на ручном source-to-sink review, а не на полном автоматическом taint scan.

## Топ-10 рисков

| № | Severity | Находка | Практический эффект |
|---|---|---|---|
| 1 | High | Глобальный rate-limit вместо per-user/per-route | Любые 100 mutation-запросов в минуту суммарно могут положить API в 429 для всех; PIN-блокировка также общая |
| 2 | High | Недельная аналитика удаляется и затем падает | `SiteWeeklyTrend` неполон/устаревает, а worker остаётся healthy |
| 3 | High | Health и deploy gate дают false green | Деплой считается успешным при отказе workers, projections и WS heartbeat |
| 4 | High | «PITR» без WAL archive | Восстановление на произвольную точку невозможно; фактический RPO — до суток |
| 5 | High | PgBouncer фактически обходится | App/workers/ws идут прямо в PostgreSQL; рост параллелизма упирается в соединения |
| 6 | High | WebSocket принимает до 100 MB и не применяет backpressure | Один авторизованный клиент способен вызвать memory/CPU DoS контейнера 384 MB |
| 7 | High, conditional | Multi-tenant изоляция fail-open и непоследовательна | Включение режима создаёт риск межтенантного чтения/изменения данных |
| 8 | Medium | WS Redis singleton не восстанавливается после стартового сбоя | 5760 ошибок heartbeat/metrics в сутки при зелёном health |
| 9 | Medium | Версия production не привязана к commit | `/api/health` показывает `2.6.0`, а не deployed SHA; расследование и rollback ненадёжны |
| 10 | Medium | Логин и UI имеют эксплуатационные/accessibility дефекты | Общий lockout по email, 16×16 password toggle без accessible name, тяжёлый фон без reduced-motion |

## Детальные находки

### H1. Rate limiter объединяет всех пользователей и все mutation routes

**Доказательство.** Production `TRUST_PROXY` не задан. [`getRateLimitIdentifier`](../src/lib/rate-limiter.ts#L484) доверяет forwarded IP только при `TRUST_PROXY=true`; иначе при неизвестном IP возвращает `host-${Host}`. [`withMutation`](../src/core/api-wrapper.ts#L108) использует этот identifier и общий лимит 100/min без route/user/tenant в ключе. PIN login передаёт тот же identifier в общий bucket.

**Следствие.** На `orionpiling.ru` все клиенты фактически делят один bucket. Нормальная активность 100+ пользователей создаст каскадные 429. Четыре неверных PIN-попытки способны заблокировать PIN-вход всем на час.

**Исправление.** Корректно настроить trusted proxy chain; ключ mutation bucket строить как `route + authenticatedUserId + tenantId`, с отдельным IP guard. Для PIN использовать IP + PIN/account fingerprint, но не глобальный host bucket. Добавить нагрузочный тест двух независимых клиентов.

### H2. Полный rebuild недельной аналитики разрушителен и падает

**Доказательство.** [`rebuildSiteWeeklyTrend`](../src/modules/reports/application/projections/rebuild.ts#L89) сначала выполняет `deleteMany({})` на строке 129, затем создаёт строки без обязательного `tenantId` на строках 132–139. Production PostgreSQL зафиксировал `null value in column "tenantId" ... violates not-null constraint`. После этого worker лишь логирует ошибку и продолжает считаться healthy. На срезе: 117 отчётов, 56 актуальных daily rows, но только 2 weekly rows.

**Следствие.** Rebuild сначала стирает рабочую проекцию, затем не может восстановить её. Аналитика показывает частичные/устаревшие данные.

**Исправление.** Строить проекцию в транзакции или staging table с атомарной заменой; включить `tenantId` в ключ агрегации и create payload; проверять expected row count; failure проекции должен переводить worker/readiness в degraded/down.

### H3. Health endpoints и deploy gate проверяют не то, что обещают

**Доказательство.** Основной `/api/health` проверяет DB/memory/env/disk, но не workers, Redis, storage, projections или реальный WS. Deep check считает WS `up`, если Redis-команда `GET system:ws:connections` выполнилась; отсутствие heartbeat превращается в `connections: 0`, а не `down` ([`websocket.ts`](../src/core/observability/health-tracker/checkers/websocket.ts#L5)). Production deep health был зелёным одновременно с тысячами WS heartbeat errors и падением projection rebuild. GitHub deploy проверяет только `/api/health`.

**Следствие.** Мониторинг и CD подтверждают работоспособность, когда бизнес-функции уже деградировали.

**Исправление.** Разделить liveness и readiness. Readiness должен проверять возраст heartbeat app/workers/ws, Redis/S3, статус миграций и freshness критичных projections. Deploy gate должен вызывать readiness и короткий бизнес-smoke test.

### H4. Заявленный PITR отсутствует

**Доказательство.** В production PostgreSQL `archive_mode=off`; WAL archive пуст. Compose прямо запускает PostgreSQL с [`archive_mode=off`](../docker-compose.prod.yml#L115), хотя timers и каталоги названы PITR/basebackup. Ночной logical dump и offsite copy действительно выполняются.

**Следствие.** Base backup без непрерывного WAL archive не даёт point-in-time recovery. При ошибке в 03:33 перед следующим dump можно потерять почти сутки данных. Название процедуры создаёт опасную уверенность.

**Исправление.** Включить и мониторить WAL archiving либо внедрить pgBackRest/WAL-G; провести документированный restore drill на отдельном хосте; измерять RPO/RTO и алертить по возрасту последнего WAL/dump.

### H5. PgBouncer развернут, но runtime его обходят

**Доказательство.** Compose задаёт `DATABASE_URL` через PgBouncer, но [`src/lib/db.ts`](../src/lib/db.ts#L76) читает только `DATABASE_URL_POSTGRES`. Для app/workers/ws `DATABASE_URL_POSTGRES` указывает прямо на `postgres` ([compose строки 76, 136, 203](../docker-compose.yml#L76)). Production `pg_stat_activity` подтвердил прямые подключения от app и workers; PgBouncer-клиентов нет.

**Следствие.** Архитектурная защита от connection storm не работает. Сейчас 31 соединение при `max_connections=200` ещё не авария, но запас для 100+ пользователей, workers и deploy overlap слабый.

**Исправление.** Выбрать один канонический runtime URL через PgBouncer, direct URL оставить только migrations/admin operations. Добавить integration check hostname и алерт по connection saturation.

### H6. WebSocket имеет 100 MB input limit и не подключённый backpressure

**Доказательство.** [`new WebSocketServer({ server })`](../src/core/realtime/server/ws-server.ts#L66) не задаёт `maxPayload`; используемый `ws` по умолчанию допускает 100 MB. Контейнер WS ограничен 384 MB. Реализованные `canSendMessage`/`recordSend` из BackpressureController встречаются только в самой реализации и тестах, а не в send path.

**Следствие.** Авторизованный клиент может прислать огромный JSON, заставить процесс выделить память и выполнить дорогой `JSON.parse`; несколько сообщений способны убить контейнер. Исходящая очередь также не получает обещанного контроля давления.

**Исправление.** Установить `maxPayload` по реальному протоколу (например 64–256 KB), валидировать схему до бизнес-обработки, добавить per-connection message/byte rate limits и реально включить backpressure в send path.

### H7. Multi-tenant режим нельзя безопасно включать

**Статус:** высокий условный риск; текущий production работает в single-tenant режиме.

**Доказательство.** RLS policies разрешают все строки, когда `app.current_tenant` не установлен ([migration](../prisma/migrations/20260425000000_enable_rls_foundation/migration.sql#L27)). Не все route/query paths выполняются в tenant transaction context. Часть кэшей и `equipment/all` глобальны. [`ensureTenantAccess`](../src/services/auth/resource-access-service.ts#L83) включает проверку только для литерала `true`, тогда как канонический режим в других местах — `multi`.

**Следствие.** Простое переключение environment variable не создаёт изоляцию и может открыть данные между организациями.

**Исправление.** Запретить multi-tenant deploy до отдельного security gate: FORCE RLS с fail-closed policy, обязательный tenant context на каждом DB transaction, tenant в cache keys, единый parser режима, negative cross-tenant test matrix для всех API.

### M1. Redis-клиент WS остаётся мёртвым после стартовой ошибки

**Доказательство.** [`redis-cache.ts`](../src/lib/redis-cache.ts#L66) сохраняет singleton до успешного connect; retry strategy прекращает попытки после двух, но ссылка не сбрасывается. В WS production отсутствует `REDIS_URL_CACHE`, используется fallback `REDIS_URL`. Прямой Redis ping из контейнера сейчас успешен, однако с момента старта каждые 30 секунд фиксируются две ошибки: 2880 heartbeat + 2880 connection-count за 24 часа.

**Следствие.** Краткий startup race становится постоянной деградацией до перезапуска контейнера; текст ошибки логируется как `{}`, что мешает диагностике.

**Исправление.** Сбрасывать singleton на terminal close/end, реализовать reconnect state machine и readiness по свежему heartbeat; передавать WS явный `REDIS_URL_CACHE`; сериализовать `Error` с message/code/stack.

### M2. Production version не идентифицирует артефакт

Live health возвращает `version: 2.6.0`, а deployed git HEAD был `2a97afc`. Build arg с SHA не становится каноническим runtime `APP_VERSION`.

**Исправление.** Встраивать immutable commit SHA и image digest в build labels и health/metrics; deploy должен сверять ожидаемый SHA с фактическим.

### M3. Email/password throttling допускает account lockout

Login bucket привязан к нормализованному email, но не имеет отдельного IP/device guard. Зная email, атакующий может блокировать конкретный аккаунт повторными ошибками; меняя email — обходить глобальную защиту.

**Исправление.** Два независимых лимита: мягкий per-IP/subnet и per-account; progressive delay вместо долгого полного lockout; алерт по распределённым попыткам.

### M4. JWT разрешён в WebSocket query string

[`authenticateWS`](../src/core/realtime/server/auth.ts#L47) принимает session token из cookie **или** `?token=`. Query string легче попадает в proxy/access logs и observability. Текущий browser client использует same-origin cookie, поэтому fallback не нужен основному сценарию.

**Исправление.** Удалить query-token либо заменить короткоживущим одноразовым WS ticket; очистить/redact URL в логах.

### M5. Public health раскрывает лишние внутренние данные

Публичный `/api/health` отдаёт точную версию, uptime, heap/RSS, disk percentage, DB provider и может вернуть raw DB error. Это облегчает fingerprinting и разведку.

**Исправление.** Публично возвращать только `{status}`; подробности — в authenticated/internal endpoint и metrics backend.

### M6. Production host содержит незатреканные env/backups

В `/opt/pilingtrack` обнаружено 9 untracked-файлов, включая `.env.production` и несколько `.env.bak*`. `.dockerignore` исключает `.env*` из build context — это хорошо. Но `.gitignore` не имеет общего правила для env-файлов.

**Следствие.** Повышен риск случайного `git add`, утечки в support bundle или неправильного выбора env при ручном deploy.

**Исправление.** Хранить secrets вне worktree (secret manager/root-owned env dir), добавить deny rules и pre-commit secret scan, удалить устаревшие backup-копии после безопасной ротации.

### M7. Compose-конфигурация имеет bootstrap trap

Даже при выключенном dev profile `docker compose config` требует `PGADMIN_PASSWORD`; переменная отсутствует в примерах. После неё обязательна `NEXT_PUBLIC_WS_URL`. Структурная валидация проходит только с ручными placeholders.

**Исправление.** Не использовать `${VAR:?}` в отключаемом profile либо вынести pgAdmin в отдельный compose-файл; добавить CI-проверку fresh-env bootstrap.

### M8. Сборочные образы недостаточно воспроизводимы

Используются mutable tags (`pgbouncer:latest` и другие). Workers Dockerfile после prune выполняет runtime `npm install --no-save ... tsx` как root; WS build скрывает ошибку `prisma generate` через `|| true`. Дополнительная проверка фактического worker image не завершилась из-за зависшего SSH-сеанса, поэтому image bloat не объявляется доказанным дефектом.

**Исправление.** Pin images по digest, формировать lockfile-driven production layer без runtime install, не подавлять codegen failures, SBOM + image scan в CI.

### M9. Password reveal control недоступен с клавиатуры/скринридера как понятное действие

На login странице кнопка имеет фактический размер 16×16 px, без `aria-label` и title ([`login-page.tsx`](../src/components/piling/login-page.tsx#L125)). Остальные поля имеют корректные labels, autocomplete и mobile font-size.

**Исправление.** Сделать hit target минимум 44×44, динамический accessible name «Показать/скрыть пароль», видимый focus state.

### M10. Login background тяжёлый и не уважает reduced motion

Три фоновых изображения суммарно около 2.5 MB переключаются каждые 12 секунд с 1.5 s fade ([`login-page.tsx`](../src/components/piling/login-page.tsx#L22)). `prefers-reduced-motion` не учитывается. На desktop карточка принудительно сдвинута на 8 cm; на mobile фон с `backgroundSize: 85% auto` выглядит случайно обрезанным.

**Исправление.** Responsive `<picture>`/AVIF, preload только первого кадра, отключение карусели по reduced-data/reduced-motion, layout через grid вместо сантиметров.

## Low / архитектурный долг

- `/dashboard` возвращает 404; реальные entry points — `/admin`, `/operator`, `/monitoring`. Контракт/документация не совпадают.
- Production — один VM: PostgreSQL, Redis, app, workers, WS и proxy имеют общий failure domain. Это допустимо для текущего масштаба, но не HA.
- `container_name` и stateful single replicas затрудняют горизонтальное масштабирование.
- В localStorage сохраняются черновики отчётов; на общем устройстве нужен явный logout cleanup/retention policy.

## Что сделано хорошо

- Сильные TLS/security headers: HSTS preload, CSP с nonce/strict-dynamic, frame deny, nosniff, COOP/CORP, TLS 1.2/1.3.
- UFW закрыт по умолчанию; публичны только 22/80/443, service ports internal/loopback.
- Контейнеры имеют healthchecks/resource limits/log rotation; на срезе restarts = 0.
- Build, TypeScript и 1413 тестов проходят; production dependency audit чист.
- DB не перегружена: 16 MB, 31 соединение, долгих запросов >30 s нет.
- Ночной logical backup и offsite R2 copy действительно выполняются.
- Login responsive, без horizontal overflow; поля имеют корректный mobile размер и autocomplete.
- Секреты не найдены в tracked source; CSP и cookie-based browser WS auth — хорошая база.

## План исправлений

### 0–48 часов

1. Исправить rate-limit keying и задать проверенную `TRUST_PROXY` конфигурацию.
2. Остановить destructive weekly rebuild; восстановить `tenantId`, транзакционность и пересобрать проекцию.
3. Сделать WS `maxPayload`, message rate limit; убрать query token.
4. Исправить Redis reconnect и алерт по отсутствию heartbeat.
5. Переименовать «PITR» в backup до реального включения WAL, чтобы runbook не лгал.

### 3–14 дней

1. Разделить liveness/readiness; добавить workers/projection freshness в deploy gate.
2. Перевести runtime подключения через PgBouncer и нагрузочно проверить 100+ sessions.
3. Включить настоящий WAL archive и провести restore drill.
4. Встроить commit SHA/image digest в health и rollback flow.
5. Убрать secrets/backups из worktree и добавить secret scanning.
6. Исправить login accessibility/performance.

### До включения multi-tenant

1. FORCE RLS + fail-closed policies.
2. Единый tenant context для всех запросов и транзакций.
3. Tenant-scoped cache keys и полный audit глобальных list endpoints.
4. Автоматическая negative matrix: tenant A никогда не читает/меняет данные tenant B.
5. Отдельный threat model и security review после изменений.

## Критерии повторной приёмки

- 100+ виртуальных пользователей не создают глобальный 429 и не исчерпывают PostgreSQL connections.
- Удаление/остановка workers или WS делает readiness красным менее чем за 90 секунд.
- Weekly projection rebuild атомарен, tenant-safe и совпадает с source reports.
- Восстановление на выбранную точку времени реально выполнено на чистой БД.
- WebSocket отвергает oversized payload до parse и выдерживает flood test в заданных лимитах.
- Cross-tenant suite проходит для каждой API-группы до изменения production mode.

## Итог для решения о релизе

**Текущий single-tenant production можно продолжать эксплуатировать при умеренной нагрузке, но только как условно допущенный.** Перед маркетинговым/операционным расширением до 100+ одновременных пользователей обязательны H1–H6. **Multi-tenant режим включать нельзя**, пока H7 не закрыт отдельной приёмкой. Главный приоритет — сделать мониторинг честным: пока ложный green остаётся, остальные дефекты будут обнаруживаться пользователями раньше команды.
