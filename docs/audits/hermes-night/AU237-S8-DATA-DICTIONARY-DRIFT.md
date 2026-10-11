# AU237-S8-DATA-DICTIONARY-DRIFT — Словарь данных: расхождение с кодом

Версия (git rev-parse HEAD): `3fde1413575e8cfffb548a89dc0dbe4eeada9f89`
Дата аудита: 2026-10-11 (RTZ 2, UTC+03:00). Только чтение, код приложения не менялся.

## Итог

Проверено соответствие `docs/DATA-SOURCES.md` (обновлён 2026-10-07) текущему коду.
Найдено 10 расхождений: **критично 0, важно 4, мелочь 6**. Крупных «фейковых источников» нет —
структура документа совпадает с кодом, расходятся детали (числа графа, состав таблиц, тип доступа).

Топ-5:
1. Числа GitNexus в шапке документа устарели: 24 935 узлов / 55 355 рёбер / 833 потока против реальных
   30 134 / 63 090 / 838 в `.gitnexus/meta.json` (плюс другой коммит и дата индексации).
2. «Аналитика техники» описана как Prisma `groupBy/aggregate`, на деле это сырой SQL по 7 таблицам
   плюс один `telemetryRecord.groupBy`.
3. Журнал забивки описан как «живой SQL … LEFT JOIN PilePassport», на деле — Prisma `findMany` с `include`.
4. История отчётов («История → ReportAudit/ReportVersion») приписана `modules/reports/*`, но читатель и
   писатель живут в `src/services/reports/*`.
5. Мелочи: пропущены таблицы `Media` (флот), `PileGrade`/`Site` (аналитика объектов), `Equipment`
   (телеметрия); описание `Math.random` не совпадает с реальными местами; MQTT нигде не запускается.

## Методика

Что и как искал (команды воспроизводимы из корня `D:\PillingR\wt-night`):

1. Числа моделей: `grep -c '^model ' prisma/schema.prisma` (и `^enum`, `^view`).
2. Числа графа: `node -e "console.log(require('./.gitnexus/meta.json').stats, require('./.gitnexus/meta.json').indexedAt, require('./.gitnexus/meta.json').lastCommit)"`.
3. Существование и таблицы каждого источника — чтение самих сервисов:
   `read_file`/`grep -n "db\\.|prisma\\.|\\$queryRaw|LEFT JOIN"` по
   `src/services/analytics/site-analytics-service.ts`, `src/services/analytics/equipment-analytics-service.ts`,
   `src/modules/monitoring/application/queries/fleet-monitoring.service.ts`,
   `src/services/telemetry/telemetry-ingestion-service.ts`,
   `src/modules/reports/application/queries/pile-journal-list.ts`,
   `src/services/reports/report-history-service.ts`, `src/services/reports/audit-service.ts`.
4. Инфраструктура: `grep -rn "new Redis|getStateRedisClient|getRedisClient"` по `src/lib/*`,
   `src/core/infrastructure/*`; `grep -n "bullmq" src/lib/pdf-queue.ts`; `grep -rn "S3Client|MinIO"`;
   `grep -rn "startMqttIngestion"` по `src/ scripts/ e2e/`.
5. Ложные подозрения из раздела «Аудит честности»: `grep -rn "Math.random"`, `grep -rln "simulat"`,
   проверка «карточка техники vs флот» по `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx`
   и `src/components/piling/monitoring/fleet-dashboard.tsx`.

Статусы: **ПРОЙДЕНО** — совпало с кодом; **НЕ ПРОВЕРЕНО** — нет доступа/данных; **ГИПОТЕЗА** — вывод по косвенным признакам.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | docs/DATA-SOURCES.md:5 | «24 935 узлов / 55 355 рёбер / 833 потока … индексация 2026-10-01, коммит 615b31e2». В `.gitnexus/meta.json` сейчас: nodes **30134**, edges **63090**, processes **838**, lastCommit **5e38a5c7**, indexedAt **2026-10-11**. | Документ ссылается на устаревший снимок графа; цифры расходятся с самим файлом, из которого якобы пересчитаны. Читатель делает выводы о «зрелости» индекса по неверным числам. | Пересчитать статистику и дату из `.gitnexus/meta.json` или явно пометить снимок как исторический. |
| 2 | важно | docs/DATA-SOURCES.md:26 | Источник аналитики техники: «Prisma: `Report`, `ReportDowntime`, `Equipment` (реальные `groupBy`/`aggregate`)». В коде — сырой SQL `$queryRaw` по `Report`, `Equipment`, `PileWork`, `PileGrade`, `LeaderDrilling`, `ReportDowntime`, `DowntimeReason` (`src/services/analytics/equipment-analytics-service.ts:70`, `:126`) и только один `telemetryRecord.groupBy` (`:150`). | Документ называет источник «Prisma groupBy/aggregate» и перечисляет 3 таблицы. Реально это SQL по 7 таблицам + телеметрия. Кто поверит — ошибётся в модели данных (например, что топливо из Report, а не из TelemetryRecord). | Переписать строку: сырой SQL, список 7 таблиц + `TelemetryRecord` (топливо, `type='fuel_total'`). |
| 3 | важно | docs/DATA-SOURCES.md:31 | «живой SQL: строки из `PileWork` … паспорт — `LEFT JOIN PilePassport` по `pileWorkId`». В коде нет ни `$queryRaw`, ни `LEFT JOIN`: это Prisma `db.pileWork.findMany` с `include: { passport: … }` (`src/modules/reports/application/queries/pile-journal-list.ts:47`, `:87`). | Формулировка «живой SQL … LEFT JOIN» вводит в заблуждение при оценке запроса/производительности и при поиске кода по SQL. | Заменить на «Prisma `findMany` по `PileWork`, паспорт подключён через relation `include` по `pileWorkId`». |
| 4 | важно | docs/DATA-SOURCES.md:30 | Строка «Отчёты / история → `modules/reports/*` (полный DDD) → `Report`, `ReportAudit`, `ReportVersion`, `Media`». Читатель истории и писатель аудита — в `src/services/*`: `getReportHistory` в `src/services/reports/report-history-service.ts:39` (`db.reportAudit.findMany` `:51`, `db.reportVersion.findMany` `:52`), `writeReportAuditRow` в `src/services/reports/audit-service.ts:29` (`:38`). | Приписывание истории и аудита модулю `modules/reports/*` неверно ориентирует при поиске точки изменения; реально путь проходит по легаси-слою `services`. | Указать фактический файл истории/аудита или разграничить, что «DDD в modules» относится к записи отчёта, а история — в services. |
| 5 | мелочь | docs/DATA-SOURCES.md:27 | Флот-мониторинг: «Prisma: `Equipment`, `Report`, `ReportAnalytics`». В коде ещё читается `Media` (`src/modules/monitoring/application/queries/fleet-monitoring.service.ts:172`, `db.media.findMany`). | Неполный список таблиц; `Media` питает `photoUrl` карточки флота. | Добавить `Media`. |
| 6 | мелочь | docs/DATA-SOURCES.md:25 | `getSiteAnalytics`: «по `Report`/`PileWork`/`LeaderDrilling`/`ReportDowntime` (+ планы `SitePilePlan`/`SiteDrillingPlan`)». В SQL также `Site` (`src/services/analytics/site-analytics-service.ts:96`) и `PileGrade` (`:108`, `:131`). | Пропущены `Site` и `PileGrade`; длины свай считаются через `PileGrade.lengthMm` — это существенная связь. | Дополнить список `Site` и `PileGrade`. |
| 7 | мелочь | docs/DATA-SOURCES.md:28 | Карточка техники → телеметрия: «Prisma: `TelemetryRecord`». Функция `findForeignEquipmentIds` читает ещё `Equipment` (`src/services/telemetry/telemetry-ingestion-service.ts:270`, `db.equipment.findMany`). | Неполный список: проверка принадлежности оборудования идёт по `Equipment`. | Добавить `Equipment`. |
| 8 | мелочь | docs/DATA-SOURCES.md:16 | Redis: перечислены как точки инициализации `redis-cache.ts`, `rate-limiter.ts`, `pdf-queue.ts`, `leader-election.ts`. `leader-election.ts` не создаёт клиента, а *берёт* его: `import { getStateRedisClient }` (`src/core/infrastructure/leader-election.ts:11`, `:123`). Разделение кэш/состояние (`REDIS_URL_CACHE` vs `REDIS_URL`) в документе не отражено (`src/lib/redis-cache.ts:45`, `:47`, `:118`, `:136`). | Читатель считает `leader-election` источником Redis, хотя это потребитель; теряется факт двух инстансов Redis. | Переформулировать: инициализация — `redis-cache.ts`; остальные — потребители; упомянуть кэш- и state-инстансы. |
| 9 | мелочь | docs/DATA-SOURCES.md:43 | «`Math.random` (9 мест) … сэмплинг, джиттер ретраев, RUM-id, ширина скелетона». Число 9 подтверждается (10 совпадений в `src`, из них 1 в тесте — `src/app/api/users/__tests__/route.test.ts:30`), но описанных применений «RUM-id» и «ширина скелетона» в коде нет. Реальные места: `idempotency`-ключи (`src/components/piling/to/readiness/api/idempotency.ts:8`), вопросы банка знаний (`src/modules/operator-mobile/domain/knowledge-bank.ts:411`, `:439`), id ассетов (`src/components/piling/monitoring/equipment-tile-asset-storage.ts:39`), джиттер (`src/services/reports/outbox-publisher.ts:39`), сэмплинг+id телеметрии (`src/services/telemetry/telemetry-ingestion-service.ts:106`, `:205`, `:212`). | Число верное, но список применений не соответствует коду — проверка «всё легитимно» опирается на устаревшее описание. | Обновить перечень применений `Math.random`. |
| 10 | мелочь | docs/DATA-SOURCES.md:18 | MQTT/HTTP ingest: «точки инициализации в коде — `mqtt-ingestion-service.ts`, `/api/telemetry/ingest`». `startMqttIngestion` нигде не вызывается, кроме реэкспорта фасада (`src/modules/telemetry/index.ts:20`); запуска MQTT-подписки в `src/`, `scripts/`, `e2e/` нет. Реально работает только HTTP-путь `/api/telemetry/ingest`. | «Точка инициализации» MQTT фактически не подключена даже как вызов — документ завышает готовность источника. | Пометить MQTT-сервис как «не подключён (только реэкспорт)», оставить HTTP-ingest. |

### Совпало с кодом (ПРОЙДЕНО, для баланса)

| # | path:line | утверждение | подтверждение |
|---|---|---|---|
| A | docs/DATA-SOURCES.md:15 | «83 модели» (`grep -c '^model ' prisma/schema.prisma`) | `grep -c '^model ' prisma/schema.prisma` → **83** (плюс 30 `enum`, 0 `view`). |
| B | docs/DATA-SOURCES.md:15 | `src/lib/db.ts` → генератор `src/generated/postgres-client` | импорт `../generated/postgres-client/client` (`src/lib/db.ts:12`), `require` `src/generated/postgres-client/client.js` (`:66`). |
| C | docs/DATA-SOURCES.md:16 | Redis питает очередь PDF через BullMQ (`src/lib/pdf-queue.ts`) | `import { Queue, Job, QueueEvents } from 'bullmq'` (`src/lib/pdf-queue.ts:18`), `new Queue(...)` (`:87`). |
| D | docs/DATA-SOURCES.md:17 | MinIO/S3 в `s3-service.ts`, `media-service.ts` | `S3Client` + `forcePathStyle` для MinIO (`src/core/storage/s3-service.ts:33`, `:37`; `src/core/media/media-service.ts:89`). |
| E | docs/DATA-SOURCES.md:25 | Аналитика объектов читает живой SQL, не проекции; проекции снесены | сырой SQL `src/services/analytics/site-analytics-service.ts:78`; таблиц Projection в `prisma/schema.prisma` нет (комментарий `:2136` «таблицы снесены миграцией 20260817220000_drop_unread_projections»). |
| F | docs/DATA-SOURCES.md:29 | Дашборд `/admin` агрегирует `getSiteAnalytics` | `src/app/(app)/admin/page.tsx:3` → `AdminDashboard`; `src/components/piling/admin-dashboard.tsx:133` → `GET /api/analytics/sites`; `src/app/api/analytics/sites/route.ts:31` → `getSiteAnalytics`. |
| G | docs/DATA-SOURCES.md:31 | Паспорт подключается по `pileWorkId`; сваи пачкой видны «без паспорта» | `src/modules/reports/application/queries/pile-journal-list.ts:43`, `:115` (докблок и обработка `passport === null`). |
| H | docs/DATA-SOURCES.md:44 | Синтетических генераторов нет (симулятор удалён) | `grep -rln "simulat"` по `src` — только тесты (`src/workers/__tests__/*`, `src/modules/equipment/infrastructure/__tests__/*`); генераторов телеметрии нет. |
| I | docs/DATA-SOURCES.md:46 | Ложное подозрение «карточка тянет флот» опровергнуто | карточка: `authFetch('/api/telemetry?...equipmentId=')` (`src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:165`); флот: `/api/monitoring/fleet` (`src/components/piling/monitoring/fleet-dashboard.tsx:89`). Это разные файлы — совпадает. |

### Мета-наблюдение (ГИПОТЕЗА)

Числа графа GitNexus не согласованы и внутри репозитория: `AGENTS.md` (блок gitnexus) указывает
«23 154 symbols / 45 336 relationships / 1 131 execution flows», `docs/DATA-SOURCES.md:5` — «24 935 / 55 355 / 833»,
а `.gitnexus/meta.json.stats` — «30 134 / 63 090 / 838». Три разных набора для одного и того же индекса.
Причину (разные worktree/коммиты/версии анализатора) по одному файлу `meta.json` установить нельзя — это ГИПОТЕЗА.

## Не проверено

1. **Прод-подключения источников.** Документ сам оговаривает (`docs/DATA-SOURCES.md:8-9`), что это
   только точки инициализации, а не подтверждение работы в проде. Без доступа к прод-БД/прод-Redis/MinIO
   факт поступления данных не проверялся — НЕ ПРОВЕРЕНО.
2. **Telegram через CF-прокси.** `docs/DATA-SOURCES.md:19` утверждает, что идёт через CF-прокси и прямой
   `api.telegram.org` заблокирован. В коде дефолт — `https://api.telegram.org` с override `TELEGRAM_API_BASE`
   (`src/core/notifications/telegram.ts:227`). Значение `TELEGRAM_API_BASE` в проде не читал (файлы `.env*`
   трогать запрещено правилами) — НЕ ПРОВЕРЕНО.
3. **«Пусто, пока нет бокса»** для `TelemetryRecord` (`docs/DATA-SOURCES.md:28`, `:44`) — утверждение о
   содержимом таблицы в проде; без БД не проверял — НЕ ПРОВЕРЕНО.
4. **Локации `EquipmentPlaceholder`/`PARAM_SPECS`.** Существование и текст подсказки совпадают с кодом
   (`src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:257` «ориентировочные, калибруются
   по установке»), но полный разбор честности всех плейсхолдеров из раздела «Аудит честности» не входил
   в задачу — частично НЕ ПРОВЕРЕНО.
5. **`ReportAnalytics` как источник флота.** Подтверждено чтение (`fleet-monitoring.service.ts:230`), но
   содержимое/актуальность таблицы в проде — НЕ ПРОВЕРЕНО.
6. **Число `Math.random` «9 мест»** — считал вручную по выводу `grep`; если автор документа считал иначе
   (например, включая/исключая тесты), формулировка «9» может и совпасть, и разойтись. Сам список применений
   точно устарел (находка №9).
