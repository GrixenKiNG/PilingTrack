# AU87-S7-REDIS-USAGE — Redis: два экземпляра, что в каком, ключи и сроки

Версия (git rev-parse HEAD рабочей папки `D:\PillingR\wt-night`): `5debf202dcd8920638721ca772a68c64e3c31fdc`
Только чтение кода. Ни один файл приложения не изменён.

## Итог

- В PilingTrack два Redis-сервера: инстанс состояния (`REDIS_URL`, `docker-compose.yml:280`) и инстанс кэша (`REDIS_URL_CACHE`, `docker-compose.yml:316`). Разделение по экземплярам сделано верно: аренда лидера, денилист сессий, счётчики лимитов, пульсы и очередь PDF лежат на инстансе состояния; справочники/аналитика/погода/LKG-ответы — на кэше.
- Политики совпадают с назначением: состояние — `noeviction` + AOF + 256mb (`docker-compose.yml:296-299`), кэш — `allkeys-lru` без AOF + 256mb (`docker-compose.yml:325-330`). Оверлей `docker-compose.prod.yml:113-122` политику не меняет.
- Найдено 9 замечаний: критичных нет, 3 «важно», 6 «мелочь». Владельцу важнее всего три: (1) `/api/health` и `/api/health/deep` пингуют ТОЛЬКО кэш-инстанс, поэтому падение инстанса состояния не видно; (2) ключ дедупа алерта о простое (состояние по смыслу, TTL 48 ч) лежит на кэш-инстансе с `allkeys-lru` и может быть вытеснен → повтор алерта; (3) при неверной конфигурации `getStateRedisClient()` молча подменяется на кэш (`redis-cache.ts:137`), и тогда состояние попадает на `allkeys-lru`.
- Ключи лимитов (`rl:*`, `rl:blocked:*`) пишутся на инстанс состояния, но БЕЗ общего префикса `pilingtrack:` (`rate-limiter.ts:125-130`) — расхождение с остальными ключами.
- Проверок «через команды» по живому Redis не делалось (прод/пароль недоступны), все выводы — по коду; они помечены статусом ПРОЙДЕНО (по коду) или ГИПОТЕЗА.

## Методика

Что и как искалось (воспроизводимо):

1. `git rev-parse HEAD` в `D:\PillingR\wt-night` — версия выше.
2. `search_files` (содержимое, `src/`): `REDIS_URL|REDIS_URL_CACHE|getRedisClient|getStateRedisClient`; `new Redis(|new Queue(|new Worker(|ioredis`; `keyPrefix`; `client.set(|setex(|eval(|publish(|subscribe(|incr(|sadd(|hset(`.
3. `search_files` (содержимое, весь репозиторий, кроме `docs/`): `REDIS_URL`, `system:worker:heartbeat|system:scheduler|system:workers`, `system:ws|ws:connections`.
4. `search_files` по `src/modules` (`redis|Redis|REDIS`) → 0 совпадений: доменные модули Redis напрямую не используют.
5. Чтение целиком: `src/lib/redis-cache.ts`, `src/core/infrastructure/leader-election.ts`, `src/services/auth/session-service.ts`, `src/lib/rate-limiter.ts`, `src/lib/cache-strategies.ts`, `src/lib/cached-queries.ts`, `src/lib/pdf-queue.ts`, `src/workers/pdf-worker.ts`, `src/workers/unified-worker/{scheduler-heartbeat,config,pdf,state}.ts`, `src/core/observability/health-tracker/checkers/{workers,schedulers,backup,redis}.ts`, `src/core/observability/health-checks.ts`, `src/core/error-boundary/api-error-boundary.ts`, `src/services/weather/weather-client.ts`, `src/app/api/analytics/sites/route.ts`, `docker-compose.yml`, `docker-compose.prod.yml`.
6. Тексты существующих отчётов в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались (запрет задания); выводы сделаны только по коду и по `docker-compose`.

Соглашение о статусах: ПРОЙДЕНО — подтверждено открытой строкой кода; ГИПОТЕЗА — вывод о поведении, не воспроизведённый на живом Redis; НЕ ПРОВЕРЕНО — см. раздел в конце.

## Инвентарь ключей (по коду)

Физический ключ = `keyPrefix` (`pilingtrack:`) + логическое имя, если клиент создан через `redis-cache.ts` (`keyPrefix: 'pilingtrack:'`, `redis-cache.ts:64`). Исключения отмечены.

| # | Ключ / шаблон | Экземпляр | TTL | Что при потере ключа | Вытеснение экземпляра | Файл:строка | Статус |
|---|---|---|---|---|---|---|---|
| 1 | `leader:outbox-worker`, `leader:projection-worker` | состояние (`getStateRedisClient`) | `PX` 30 000 мс, продлевается каждые 10 000 мс | Лидер-воркер остановится (outbox/projection встанут до переизбрания); второй инстанс подхватит лидерство | `noeviction` | `leader-election.ts:50`, `:172-184`, `:248-252` | ПРОЙДЕНО |
| 2 | `revoked-jti:<jti>` | состояние (`process.env.REDIS_URL`, свой клиент + `keyPrefix`) | `EX` = остаток жизни токена (≤ 43200 c = 12 ч) | Отозванный токен снова станет валидным до естественного истечения (fail-open) | `noeviction` | `session-service.ts:110-122`, `:148`, `:163` | ПРОЙДЕНО |
| 3 | `rl:<identifier>` (счётчик) | состояние (`process.env.REDIS_URL`, свой клиент, БЕЗ `keyPrefix`) | `PX` = окно (15 мин) | Счётчик попыток входа обнулится → лишние попытки перебора | `noeviction` | `rate-limiter.ts:119-130`, `:208`, `:72` | ПРОЙДЕНО |
| 4 | `rl:blocked:<identifier>` (блокировка) | состояние (там же) | `PX` = срок блокировки (30 мин / 15 мин) | Блокировка аккаунта/IP снимется досрочно → перебор продолжится | `noeviction` | `rate-limiter.ts:209`, `:82` | ПРОЙДЕНО |
| 5 | `system:worker:heartbeat:<worker>` | состояние (`getStateRedisClient`) | `EX` 120 c | Пульс воркера считается «мёртв» → `checkWorkers` вернёт `stopped` | `noeviction` | `workers.ts:58`, `:22` | ПРОЙДЕНО |
| 6 | `system:workers` (set имён) | состояние | бессрочно (TTL нет) | Имена воркеров из набора не удаляются никогда; набор растёт | `noeviction` | `workers.ts:59`, `:13` | ПРОЙДЕНО |
| 7 | `system:scheduler:<имя>` | состояние (`getStateRedisClient`) | `EX` = 3 интервала планировщика | Пульс отсутствует → планировщик считается `stale` в deep-health | `noeviction` | `scheduler-heartbeat.ts:40-41`, `schedulers.ts:33` | ПРОЙДЕНО |
| 8 | `system:backup:last_timestamp`, `:last_size`, `:s3_synced` | состояние (пишет `scripts/backup.sh`, читает `getStateRedisClient`) | `EX` 172800 c (48 ч) | Метрика свежести бэкапа пропадёт → фолбэк на файловую систему | `noeviction` | `backup.ts:83`, `:89-91`; `scripts/backup.sh:95-97` | ПРОЙДЕНО |
| 9 | `bull:pdf-generation:*` (BullMQ, `prefix: 'pilingtrack'`) | состояние (`process.env.REDIS_URL`) | `removeOnComplete` age 3600 c / 1000 шт.; `removeOnFail` 24 ч / 5000 шт. | Задача PDF потеряется / статус станет `not-found` | `noeviction` | `pdf-queue.ts:27`, `:89`, `:96-97`; `pdf-worker.ts:26`, `:37`, `:44` | ПРОЙДЕНО |
| 10 | `weather:conditions:<key>` | кэш (`cache.getOrSet` → `getRedisClient`) | 900 c (15 мин) | Свежий запрос в Open-Meteo | `allkeys-lru` | `weather-client.ts:73`, `:162-165` | ПРОЙДЕНО |
| 11 | `crews:all` | кэш | 300 c | Перечитка из БД | `allkeys-lru` | `cached-queries.ts:38-51` | ПРОЙДЕНО |
| 12 | `dictionary:<tenant>:all` | кэш | 900 c | Перечитка справочников организации | `allkeys-lru` | `cached-queries.ts:64-76` | ПРОЙДЕНО |
| 13 | `analytics:sites:v3:<tenant>:<from>:<to>:<site>` | кэш | 300 c | Пересчёт сводки по объектам | `allkeys-lru` | `analytics/sites/route.ts:28-33` | ПРОЙДЕНО |
| 14 | `errboundary:lkg:<cacheKey>` | кэш | 300 c | Деградация отдаст пустой ответ вместо last-known-good | `allkeys-lru` | `api-error-boundary.ts:158-159`, `:167-174`, `:203-208` | ПРОЙДЕНО |
| 15 | `mutex:<key>` (антистампид) | кэш | `EX` = `mutexTtl` (по умолчанию 10 c) | Возможен повторный параллельный расчёт | `allkeys-lru` | `cache-strategies.ts:118-124` | ПРОЙДЕНО |
| 16 | `alert:downtime:<tenant>:<report>:<reason>:<dur>` | КЭШ (`getRedisClient`) — см. находку №3 | `EX` 172800 c (48 ч) | Повторный алерт о простое (дубль в Telegram) | `allkeys-lru` | `event-handlers.ts:292`, `:311`, `:338`, `:421` | ПРОЙДЕНО |

Примечание к таблице: строки 3-4 физически лежат как `rl:*` (без `pilingtrack:`), строки 9 — как `pilingtrack:bull:*`, остальные state-ключи — как `pilingtrack:<имя>` (клиент добавляет `pilingtrack:`).

## Политики вытеснения экземпляров (docker-compose)

- Инстанс состояния `redis` (`docker-compose.yml:280-308`): `--appendonly yes` (`:294-295`), `--maxmemory 256mb` (`:296-297`), `--maxmemory-policy noeviction` (`:298-299`). Комментарий в файле прямо объясняет выбор: потеря счётчика = лишнее окно перебора, потеря задачи = потеря работы (`:273-278`).
- Инстанс кэша `redis-cache` (`docker-compose.yml:316-339`): `--save ""` (без AOF, `:325-326`), `--maxmemory 256mb` (`:327-328`), `--maxmemory-policy allkeys-lru` (`:329-330`).
- Переменные окружения: `app` получает обе (`docker-compose.yml:81-82`), `workers` тоже обе (`:171-172`).
- Прод-оверлей `docker-compose.prod.yml:113-122` для `redis` меняет только `ports`/`deploy.resources`/`logging`; `redis-cache` в оверлее отсутствует. Политики в проде — те же (`noeviction` / `allkeys-lru`).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление | Статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/core/observability/health-tracker/checkers/redis.ts:9`; `src/core/observability/health-checks.ts:144-145`; `src/lib/redis-cache.ts:118-120`; `docker-compose.yml:82` | Обе проверки здоровья Redis (`checkRedis` в deep-health и `checkRedis` в `/api/health`) берут клиент через `getRedisClient()`, а он при заданном `REDIS_URL_CACHE` указывает на КЭШ-инстанс (`redis-cache.ts:45,118-120`). Инстанс состояния не пингуется нигде. | В проде `REDIS_URL_CACHE` задан (`docker-compose.yml:82`), значит health пингует только кэш. Инстанс состояния с `noeviction` может умереть/деградировать — при этом: лимиты входа, денилист сессий, аренда лидера и очередь PDF живут именно на нём. `/api/health` останется зелёным при живом кэше и мёртвом состоянии. | Пинговать ОБА экземпляра (добавить отдельную проверку для `getStateRedisClient()`), при отказе любого из них — как минимум `warn`. | ГИПОТЕЗА (поведение выведено из кода; на живом Redis не воспроизводилось) |
| 2 | важно | `src/lib/redis-cache.ts:137` | `getStateRedisClient()` при отсутствии `REDIS_URL_CACHE` возвращает кэш-клиент (`cacheSlot`). `REDIS_URL` при этом может быть не задан вовсе (тогда `stateSlot.url` = `redis://localhost:6379`, `:47`). | Если `REDIS_URL_CACHE` выключен (как в `docker-compose.staging.yml`/`.ps1`-заготовках, где только `REDIS_URL`), состояние ляжет на тот же инстанс, что и кэш; а если инстанс окажется `allkeys-lru`, ключи лидерства/денилиста/лимитов с `noeviction`-допущением начнут вытесняться. В боевом `docker-compose.yml` оба заданы, поэтому прод не затронут. | Сделать отказ явным: если состояние и кэш схлопываются, писать предупреждение в лог (и не считать состояние защищённым от вытеснения). | ГИПОТЕЗА (код читается однозначно; прод-конфиг не затронут) |
| 3 | важно | `src/services/reports/event-handlers.ts:338`, `:341`, `:347`, `:421` | Ключ дедупликации алерта о простое `alert:downtime:*` — по смыслу это СОСТОЯНИЕ («алерт отправлен, повторять нельзя»), но читается/пишется через `getRedisClient()` (кэш-инстанс, `allkeys-lru`), TTL 48 ч (`:292`). | Под нагрузкой/давлением памяти `allkeys-lru` вытеснит ключ раньше 48 ч; следующее сохранение отчёта с тем же простоем снова пошлёт алерт диспетчеру (дубль). Ключ попал в инстанс кэша намеренно для «второго Redis» по логу, но семантике это состояние. | Перенести чтение/запись ключа на `getStateRedisClient()` (как пульсы/бэкап), либо явно задокументировать, что дубль алерта — приемлемый риск. | ПРОЙДЕНО (по коду) |
| 4 | мелочь | `src/lib/rate-limiter.ts:119-130`, `:208-209` | Клиент лимитера создаётся напрямую (`new Redis(process.env.REDIS_URL, …)`) без `keyPrefix: 'pilingtrack:'`, поэтому ключи лимитов физически `rl:*` и `rl:blocked:*` — без общего префикса. | Все прочие state-ключи идут как `pilingtrack:*`. При совместном использовании инстанса другим приложением возможна коллизия `rl:*`; поиск/очистка по префиксу `pilingtrack:` не находит ключи лимитов. | Добавить `keyPrefix: 'pilingtrack:'` в клиент лимитера (учесть в `invalidatePattern`). | ПРОЙДЕНО (по коду) |
| 5 | мелочь | `src/core/observability/health-tracker/checkers/workers.ts:59`, `:13` | Набор `system:workers` пополняется (`sadd`) при каждом пульсе, но не чистится (`srem`/TTL нет); читатель берёт только `smembers`. | Имена воркеров накапливаются в множестве навсегда. Логика берёт максимальный возраст пульса, поэтому вред ограничен ростом множества, но мусор копится. | Чистить множество (TTL у элемента нет — завести отдельный ключ со сроком или периодическую уборку). | ПРОЙДЕНО (по коду) |
| 6 | мелочь | `src/core/observability/__tests__/health-tracker.test.ts:112` | Ключ `system:ws:connections` встречается только в тесте; файла-проверки WS (`checkers/websocket.ts`) в `src/core/observability/health-tracker/checkers/` нет (см. листинг каталога), писателя ключа в `src/` тоже нет. | Ссылка на WS-пульс осталась только в тесте; deep-health больше не проверяет websocket-подсистему через Redis. Либо тест проверяет то, чего нет в коде, либо ключ «осиротел». | Либо удалить/переработать тест и ссылку на ключ, либо вернуть проверку WS, если она нужна. | ГИПОТЕЗА (по коду; отдельного WS-сервера в репозитории не найдено) |
| 7 | мелочь | `src/lib/pdf-queue.ts:43-49` | `checkRedisAvailability()` создаёт отдельное разовое соединение (`new Redis(...)`, `ping`, `quit`) при первом вызове, а `createRedisConnection()` (`:58-74`) — ещё одно постоянное. | Два независимых соединения к инстансу состояния на PDF-путь плюс клиенты в `redis-cache.ts`, `rate-limiter.ts`, `session-service.ts`, `leader-election`/`pdf.ts` — растёт число TCP-соединений к Redis. Не ошибка, но учёт соединений и закрытие не централизованы. | Переиспользовать уже открытое соединение для проб доступности либо отложить создание до реальной необходимости. | ПРОЙДЕНО (по коду) |
| 8 | мелочь | `src/core/observability/health-tracker/checkers/redis.ts:6-20`; `src/core/observability/health-checks.ts:136-162` | Ответ health про Redis не различает, какой экземпляр проверялся (нет метки instance/url). | Мониторинг не может отличить «кэш жив, состояние мертво» от «оба живы» по имени компонента. Связано с находкой №1: даже добавив пинг состояния, важно развести метки. | Добавить в `details` имя экземпляра (`cache`/`state`). | ПРОЙДЕНО (по коду) |
| 9 | мелочь | `docker-compose.yml:274` (комментарий) | Комментарий сервиса `redis` заявляет назначение «rate-limit counters, queues, pub/sub», но pub/sub в коде приложения нет: `publish/subscribe` в `src/` не найдены (единственный `subscribe` — MQTT, `src/services/telemetry/mqtt-ingestion-service.ts:162`, к Redis не относится). | Документация расходится с кодом: ожидание «pub/sub есть» может увести отладку по ложному следу. | Поправить комментарий (убрать «pub/sub») либо зафиксировать, что каналы зарезервированы под будущее. | ПРОЙДЕНО (по коду) |

## Не проверено

- Значения ключей, реальные TTL и фактические политики `maxmemory-policy` на живом Redis не проверялись: нет доступа к прод-серверу/паролю `REDIS_PASSWORD`, чтение `.env*` запрещено (AGENTS.md §1). Всё «Экземпляр/TTL» — из кода и `docker-compose*.yml`, а не из `redis-cli CONFIG GET`/`TTL`.
- Не проверено, действительно ли в прод-окружении заданы ОБА `REDIS_URL` и `REDIS_URL_CACHE` и какие значения: `docker-compose.yml` задаёт их в контейнерах, но фактический `.env` боя не читался. Находки №1/№2 зависят от этого.
- Не проверено, какой реально инстанс Redis поднимает хост-таймер бэкапа (`scripts/backup.sh` использует `$REDIS_URL`); совпадение с инстансом, который читает `backup.ts`, подтверждено только по имени переменной и комментарию `backup.ts:3-8`.
- Существование отдельного WS-сервиса (писателя `system:ws:connections`) не проверялось; в репозитории кода WS-сервера не найдено, что и отражено в находке №6 как ГИПОТЕЗА.
- Поведение при вытеснении (реальное вытеснение ключа `alert:downtime:*` и повторный алерт) не воспроизводилось на живом `allkeys-lru` — вывод о риске сделан по конфигурации политики и TTL.
- Нагрузочные/стресс-скрипты (`scripts/redis-stress-test.js`, `load-tests/event-storm.ts`, `load-tests/slo-monitor.ts`, `e2e/fixtures/disposable-*.ts`) прочитаны не полностью: они не входят в рантайм приложения и на выводы не влияют.
- Тесты, ссылающиеся на Redis, читались выборочно (моки `getRedisClient`/`getStateRedisClient`); полный прогон тестов не выполнялся — это аудит кода, не прогон.
