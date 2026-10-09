# AU58-S8 — Телеметрия PilingTrack: что включено и что спит

Версия (git rev-parse HEAD рабочей папки): `b54d31eca752e1e7d84199d71c8458a5c3e073b4`
Ветка: `hermes/q4-0926`. Работа только на чтение; единственный созданный файл — этот отчёт.

## Итог

- Телеметрия физически **спит**: ни один телематический бокс не подключён, MQTT-подписка не запускается, таблица `TelemetryRecord` пуста. Код и маршруты приёма собраны и в сборке, но данных нет.
- Severity: **критично 0 · важно 8 · мелочь 14** (всего 22 находки). Критичных не нашёл: телеметрия не несёт боевых данных, а все описанные дефекты проявляются только при подключении железа.
- Топ-5:
  1. `startMqttIngestion` не вызывается **нигде** — фоновой MQTT-подписки в проде нет (`src/services/telemetry/mqtt-ingestion-service.ts:130`).
  2. Пакет `mqtt` не объявлен в `package.json` — динамический `import('mqtt')` всегда падёт, даже если задать `MQTT_BROKER_URL` (`mqtt-ingestion-service.ts:141-146`).
  3. Два независимых пути приёма расходятся: `/api/telemetry` пишет через буфер (сэмплирование + circuit breaker), а `/api/telemetry/ingest` пишет напрямую `createMany`, минуя и буфер, и защиту (`src/app/api/telemetry/ingest/route.ts:330-332`).
  4. Обработчик MQTT читает `Equipment` без контекста организации — под fail-closed RLS вернёт `null` и **молча выбросит** каждое сообщение (`mqtt-ingestion-service.ts:96-104`) — гипотеза, рантайм не проверялся.
  5. Нет ретеншена/партиционирования у `TelemetryRecord`: `scripts/setup-partitioning.ts` есть, но это ручной пользовательский скрипт, в миграциях его нет (`prisma/schema.prisma:2034-2052`).

## Методика

Что и как искал (скрипты приведены и воспроизводимы из корня репозитория):

- `git rev-parse HEAD` → версия выше.
- `find src -path '*telemetry*' -type f` → 13 файлов телеметрии.
- `wc -l src/services/telemetry/*.ts src/app/api/telemetry/**.ts src/modules/telemetry/index.ts` → объём (см. таблицу ниже).
- `grep -rn "startMqttIngestion" src` → 3 совпадения (объявление + комментарий + ре-экспорт), вызовов нет.
- `grep -rn "getLatestTelemetry\|getTelemetryStats" src` → только определения, потребителей нет.
- `grep -rn "setSamplingConfig" src tests e2e` → определение + ре-экспорт, вызовов нет.
- `grep -rn "@/modules/telemetry" src tests e2e` → 0 совпадений, фасад никем не импортируется.
- `grep -rn "telemetry.recorded" src` → контракт + реестр схем + тест, публикации нет.
- `grep -rn "TelematicsDevice\|telematicsDevice" src | grep -v generated` → 18 строк; запись/создание отсутствуют.
- `grep -rn "device-keys" src tests` → только маршрут + тесты, UI-клиента нет.
- `grep -n "MQTT\|TELEMETRY" .env.example .env.production.example` → 0 (MQTT нигде не описан).
- `grep -n "mqtt" package.json` → exit 1 (пакет не объявлен).
- `grep -n "telemetry\|mqtt" vitest.config.ts` → файл MQTT исключён из покрытия (`:63`).
- Прочитаны целиком: `src/services/telemetry/*.ts` (4 файла), `src/app/api/telemetry/{route,ingest/route,batch/route}.ts`, `src/app/api/equipment/[id]/device-keys/route.ts`, `src/modules/telemetry/index.ts`, `src/core/event-bus/schema-registry/schemas/telemetry.ts`, `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx`, `scripts/setup-partitioning.ts`, `src/instrumentation.ts`, а также модели `DeviceKey`/`TelematicsDevice`/`TelematicsDeviceAssignment`/`TelemetryRecord` в `prisma/schema.prisma` и миграции RLS.
- Существующие отчёты в `docs/audits/**` и `docs/strategy` **не читались** (требование независимости; совпадения из вывода `grep` не использовались как доказательства).

## Карта модуля телеметрии

Числа — из `wc -l` (команда в «Методике»). Все строки `файл:строка` открыты.

| часть | назначение | включена ли | кто потребляет | файл:строка |
|---|---|---|---|---|
| Приём HTTP (сессия) | POST/GET телеметрии от залогиненного пользователя (ADMIN/DISPATCHER/OPERATOR) | да, в сборке | UI карточки техники (`/api/telemetry` GET) | `src/app/api/telemetry/route.ts:83,240,372` |
| Приём HTTP (устройство) | POST/PATCH приёма от бокса по ключу `X-Device-Key`, прямой `createMany` | да, в сборке | нет клиента кроме самого бокса | `src/app/api/telemetry/ingest/route.ts:95,141,341` |
| Приём HTTP (batch, сессия) | POST массива до 100 записей через буфер | да, в сборке | нет UI-клиента | `src/app/api/telemetry/batch/route.ts:64` |
| MQTT-подписка | подписка `pilingtrack/telemetry/#`, разбор сообщения → `ingestTelemetry` | **нет** (нет вызова, нет пакета, нет env) | — | `src/services/telemetry/mqtt-ingestion-service.ts:130` |
| Буфер записи | in-memory буфер, пакетная запись, circuit breaker, drop-oldest | да (когда есть приём) | `/api/telemetry`, `/api/telemetry/batch` | `src/services/telemetry/telemetry-buffer.ts:55,236` |
| Сэмплирование/лимит | вероятностное + адаптивное сэмплирование, лимит 1000 зап/с | да | внутри сервиса приёма | `src/services/telemetry/telemetry-ingestion-service.ts:87,105,112` |
| Ключи устройств | выпуск/отзыв `DeviceKey`, HMAC-хеш `keyHash` | да, в сборке | админ по API (UI-клиента нет) | `src/services/telemetry/device-key-service.ts:51,109,154` |
| Аутентификация устройства | поиск ключа по HMAC-хешу, проверка `revoked`, `lastUsedAt` | да | `/api/telemetry/ingest` | `src/services/telemetry/device-key-service.ts:109-152` |
| Хранение | модель `TelemetryRecord` (append-only, без TTL/ретеншена) | да (пустая) | агрегаты читают напрямую | `prisma/schema.prisma:2034-2052` |
| Проекции | агрегаты `aggregate`/`groupBy` по источнику напрямую; CQRS-проекции нет | да | `/api/telemetry?action=stats|analysis`, аналитика топлива | `telemetry-ingestion-service.ts:361,403`; `src/services/analytics/equipment-analytics-service.ts:150` |
| Событие `telemetry.recorded` | контракт + JSON-схема в реестре событий | **нет** (никем не публикуется) | — | `src/core/event-bus/schema-registry/schemas/telemetry.ts:5`; `src/core/event-bus/schema-registry/schemas/telemetry.ts` |
| Фасад модуля | ре-экспорт сервисов телеметрии | **нет** (нет импортёров) | — | `src/modules/telemetry/index.ts:1-22` |
| Таблицы `TelematicsDevice`/`…Assignment` | фундамент под PUSH/PULL-боксы | да (пустые; UI читает, кода записи нет) | карточка техники, настройки техготовности | `prisma/schema.prisma:1648,1725`; `src/modules/equipment/application/queries/equipment-query.service.ts:82` |

Объём кода: `telemetry-ingestion-service.ts` 436 строк, `mqtt-ingestion-service.ts` 207, `telemetry-buffer.ts` 236, `device-key-service.ts` 159, `api/telemetry/route.ts` 372, `api/telemetry/ingest/route.ts` 354, `api/telemetry/batch/route.ts` 180, `device-keys/route.ts` 162, `modules/telemetry/index.ts` 22 — итого 2128 строк.

## Находки

Severity: критично/важно/мелочь. Статус: ПРОЙДЕНО (код прочитан и утверждение проверено по коду) / ГИПОТЕЗА (поведение в рантайме/на БД не проверялось).

| # | severity | path:line | проблема | сценарий / почему важно | исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:130` | `startMqttIngestion` не вызывается нигде в репозитории | Фоновой MQTT-подписки в проде нет; телеметрия с боксов по MQTT не принимается. Статус ПРОЙДЕНО | Подключить при вводе железа (не удалять — спящий код) |
| 2 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:141-146` | `await import('mqtt')` без объявленной зависимости | `grep -n "mqtt" package.json` → exit 1: пакета нет. Даже с `MQTT_BROKER_URL` функция залогирует «mqtt package not installed» и вернёт заглушку. Статус ПРОЙДЕНО | Объявить `mqtt` как зависимость при подключении железа |
| 3 | важно | `src/app/api/telemetry/ingest/route.ts:330-332` | Приборный путь пишет `createMany` напрямую | Минует `TelemetryBuffer` (батчинг), сэмплирование, `checkCircuitBreaker` и усечение — в отличие от сессионного `/api/telemetry`. Статус ПРОЙДЕНО | При включении железа свести оба пути к одному (буфер) |
| 4 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:96-104` | Чтение `Equipment` без tenant-контекста | `Equipment` переведена в fail-closed RLS (`prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:53,82`): при незаданном `app.current_tenant` возвращается `null` → «unknown equipmentId, dropping message». Сообщения будут молча теряться. Статус ГИПОТЕЗА (фактическая роль БД в рантайме не проверялась) | При подключении MQTT заводить контекст организации до чтения Equipment |
| 5 | важно | `prisma/schema.prisma:2034-2052`; `scripts/setup-partitioning.ts:20-77` | Нет ретеншена/TTL и нет партиционирования в миграциях | `setup-partitioning.ts` — ручной скрипт «DROP TABLE … CASCADE», не миграция; при подключении железа таблица растёт как append-only поток. Статус ПРОЙДЕНО (отсутствие политики ретеншена в схеме/миграциях) | Продумать ретеншен до подключения железа |
| 6 | важно | `src/services/telemetry/telemetry-ingestion-service.ts:105-144,203-205` | Тихое вероятностное/адаптивное сэмплирование может отбросить до 90% записей | При нагрузке > `loadThreshold` (500/с) `rate` снижается до `minRate` (0.1); отброшенные записи не сохраняются и не метрикуются (только `logger.warn`). Статус ПРОЙДЕНО | Взвесить риск для данных замеров; вынести счётчик отброшенного |
| 7 | важно | `src/services/telemetry/device-key-service.ts:72,155` | Выпуск/отзыв `DeviceKey` без аудита | Ключ = право записи телеметрии по установке; в журнале не видно, кто и когда выдал/отозвал. Статус ПРОЙДЕНО | `recordAuditEvent` на выпуск/отзыв |
| 8 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:158` | Логируется `brokerUrl` как есть | `MQTT_BROKER_URL` часто содержит учётные данные (`mqtt://user:pass@host`); при подключении пароль брокера попадёт в лог открытым текстом. Статус ПРОЙДЕНО | Маскировать userinfo в URL перед логом |
| 9 | мелочь | `src/modules/telemetry/index.ts:1-22` | Фасад модуля никем не импортируется | `grep -rn "@/modules/telemetry"` → 0. Мёртвая прослойка (но по архитектуре это публичный фасад — не удалять). Статус ПРОЙДЕНО | — |
| 10 | мелочь | `src/services/telemetry/telemetry-ingestion-service.ts:281` | `getLatestTelemetry` без потребителей | Только определение + throw, вызовов нет. Статус ПРОЙДЕНО | — |
| 11 | мелочь | `src/services/telemetry/telemetry-ingestion-service.ts:340` | `getTelemetryStats` без потребителей | Только определение, вызовов нет. Статус ПРОЙДЕНО | — |
| 12 | мелочь | `src/services/telemetry/telemetry-ingestion-service.ts:156`; `src/modules/telemetry/index.ts:13` | `setSamplingConfig` экспортируется, но не вызывается | Сэмплирование нельзя настроить извне. Статус ПРОЙДЕНО | — |
| 13 | мелочь | `src/core/event-bus/schema-registry/schemas/telemetry.ts:5`; `src/core/shared/types/event-contracts.ts:69,247` | Событие `telemetry.recorded` объявлено, но не публикуется | Контракт + схема есть, `eventBus.publish('telemetry.recorded')` в коде нет. Спит вместе с модулем. Статус ПРОЙДЕНО | — |
| 14 | мелочь | `src/app/api/telemetry/batch/route.ts:125-126` | Устаревший комментарий «Telemetry has no tenantId column» | У `TelemetryRecord` колонка `tenantId` есть (`prisma/schema.prisma:2037`). Комментарий вводит в заблуждение. Статус ПРОЙДЕНО | Поправить комментарий |
| 15 | мелочь | `prisma/schema.prisma:2048-2051`; `src/services/telemetry/telemetry-ingestion-service.ts:361` | Нет индекса `(tenantId, timestamp)` | `getTelemetryStats` агрегирует по `tenantId` + диапазону `timestamp`; есть только `[tenantId]`. При росте таблицы — тяжёлый агрегат. Статус ПРОЙДЕНО | Добавить индекс (миграция — отдельная задача владельца) |
| 16 | мелочь | `src/app/api/equipment/[id]/device-keys/route.ts:66,98,128` | Маршрут выпуска/отзыва ключей без UI-клиента | `grep -rn "device-keys" src/components` → 0; ключи можно завести только прямым запросом/API. Статус ПРОЙДЕНО | — |
| 17 | мелочь | `prisma/schema.prisma:1648,1725`; `src/modules/equipment/application/queries/equipment-query.service.ts:82` | Таблицы `TelematicsDevice`/`…Assignment` никем не заполняются | UI читает `telematicsDevices` (карточка техники, настройки техготовности), но кода create/update нет — всегда пусто. Статус ПРОЙДЕНО | — |
| 18 | мелочь | `src/app/api/telemetry/route.ts:159,196` | `type` — произвольная строка (≤50) для сессионного пути | Валидный список типов проверяет только `/api/telemetry/ingest` (`ingest/route.ts:236-257`); через `/api/telemetry[/batch]` можно записать любой `type`. Статус ПРОЙДЕНО | Ограничить enum на обоих путях |
| 19 | мелочь | `src/services/telemetry/telemetry-ingestion-service.ts:87-99,224-237` | Лимит 1000/с считается в процессе и по вызову, а не по записи | Пакет из 100 записей инкрементит счётчик один раз; окно сбрасывается только при следующем вызове. Лимит не отражает реальную нагрузку. Статус ПРОЙДЕНО | Считать по числу записей |
| 20 | мелочь | `src/app/api/telemetry/ingest/route.ts:95,141` | POST/PATCH идут через `withApi`, а не `withMutation` | Ручной CSRF/лимит в маршруте (по правилам AGENTS §3 — не дублировать). Осознанно (нет сессии, есть ключ устройства), но отклонение от конвенции. Статус ПРОЙДЕНО | — |
| 21 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:58` | `(parseInt(MQTT_QOS) as 0|1|2) || 1` | Мусор в `MQTT_QOS` молча даёт QoS 1; значение вне 0..2 приводится типом без проверки. Статус ПРОЙДЕНО | Строгий парсер |
| 22 | мелочь | `src/services/telemetry/telemetry-buffer.ts:236` | Буфер — per-process singleton | В многопроцессном/серверлесс-окружении буферы не разделяются; при жёстком выходе процесса записи теряются (есть graceful-flush по SIGTERM/SIGINT, `:204-232`). Статус ПРОЙДЕНО | — |

## Что можно считать спящим кодом (не предлагая удалять)

Всё перечисленное — спящее по решению владельца (железо не подключено), а не мёртвое; удалять нельзя:

- MQTT-контур: `startMqttIngestion`/`stopMqttIngestion` (`mqtt-ingestion-service.ts:130,198`) — нет вызова, нет пакета `mqtt`, нет `MQTT_*` в env/примерах.
- Событие `telemetry.recorded` — контракт и схема есть, публикации нет (`schemas/telemetry.ts:5`).
- Таблицы `TelematicsDevice`/`TelematicsDeviceAssignment` — читаются UI, не заполняются (`schema.prisma:1648,1725`).
- Приборный маршрут `/api/telemetry/ingest` и ключи устройств — сборка есть, клиента/железа нет (`ingest/route.ts:95`; `device-keys/route.ts:66`).
- Фасад `@/modules/telemetry` и неиспользуемые экспорты (`getLatestTelemetry`, `getTelemetryStats`, `setSamplingConfig`) — задел под железо.

## Включено в production

- Флага «телеметрия вкл/выкл» в коде нет. Маршруты `/api/telemetry`, `/api/telemetry/batch`, `/api/telemetry/ingest`, `/api/equipment/[id]/device-keys` компилируются в сборку всегда.
- Единственная реальная точка включения MQTT — переменная `MQTT_BROKER_URL` (`mqtt-ingestion-service.ts:50,133`), но её никто не вызывает и `MQTT_*` нигде не документированы (`grep "MQTT" .env.example .env.production.example` → 0).
- `DEVICE_KEY_LOOKUP_SECRET` — обязателен вне dev/test: код бросает `ServiceError:500` (`device-key-service.ts:20-30`), `validate-env.ts:46-52,176-183` требует его при `NODE_ENV=production`; в `.env.production.example:10` и `docker-compose.yml:85` присутствует. Ключ устройства без него не выпустить.
- Фактические значения env на проде и число строк в `TelemetryRecord` не проверялись (запрет на `.env` и прод-БД).

## Не проверено

- Реальное число строк в `TelemetryRecord`, `DeviceKey`, `TelematicsDevice` на боевой БД — доступа нет; вывод «пусто» основан на отсутствии подключённого железа и отсутствии вызовов MQTT, а не на запросе к БД.
- Фактическое поведение fail-closed RLS для `Equipment` в MQTT-пути на боевой роли БД — только по тексту политики и миграций, рантайм не воспроизводился (см. находку #4, статус ГИПОТЕЗА).
- Наличие/отсутствие пакета `mqtt` в `node_modules` (проверял только `package.json`).
- Полнота ретеншена: не смотрел политики очистки/бэкапов в инфраструктурных скриптах за пределами `prisma/` и `scripts/setup-partitioning.ts`.
- E2E/Playwright-спеки по телеметрии не запускались (задача только на чтение).
- Существующие отчёты `docs/audits/**` и `docs/strategy` не читались (требование независимости), поэтому пересечения с прошлыми аудитами не сверялись.
