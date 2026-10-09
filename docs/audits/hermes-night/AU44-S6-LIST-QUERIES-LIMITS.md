# AU44-S6-LIST-QUERIES-LIMITS — Запросы списков: лимиты, индексы, рост данных

Версия кода (git rev-parse HEAD): `fd9c103a3900daaf1fcf064e36a5d30d5b5d0816`, ветка `hermes/q4-0926`.
Аудит независимый, только чтение: код приложения не менялся. Отчёт создан в этом файле; другие отчёты в
`docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались.

## Резюме для владельца (5 строк)

1. Нашёл 4 критичных места, где список читается из базы целиком, без ограничения: выгрузки журналов
   (CSV/Excel отчётов, XLSX журнала забивки-отчёт готовности), цепочка аудита готовности и KPI-обзор за период.
   Любое из них при росте данных в 10 раз уносит в память процесса десятки тысяч строк с вложенными детьми.
2. Все 4 не имеют ни `take`, ни курсора; у трёх из них фильтр опирается на индекс, который покрывает не весь
   `WHERE`, а у одного (снимки готовности) диапазон по дате идёт после `equipmentId` и индекс не помогает.
3. Ещё в 8 местах (`важно`) без лимита грузятся: история установки (до 1000 отчётов + окно 30 дней), карты
   имён (все пользователи/объекты/техника тенанта) при открытии истории отчёта и сущности, история
   инструктажей всех работников, журналы ТО/топлива, пересборка проекций.
4. Где лимиты есть — они корректны и продуманы: журнал забивки ограничен 20000 строк + отдельный
   rate-limit, период отчётов ограничен 2000 с явной ошибкой 422, списки отчётов/пользователей/техники/
   бригад/объектов идут с курсором. Это ПРОЙДЕНО, трогать не нужно.
5. Главный риск — не «медленно», а «упало по памяти»: четыре критичных места собирают ответ в памяти
   целиком (CSV/XLSX/цепочка аудита), и сработают они не постепенно, а при переходе объёма.

## Итог

- Критично: 4. Важно: 8. Мелочь: 13. Всего находок: 25.
- Топ-5 по опасности роста:
  1. Чтение всей цепочки аудита готовности — `src/modules/readiness/infrastructure/audit/audit-repository.ts:87`.
  2. Выгрузка readiness (`dataset=reports`) без лимита — `src/app/api/readiness/export/route.ts:102`.
  3. Выгрузка отчётов CSV/XLSX без лимита — `src/modules/reports/application/queries/report-export.service.ts:135`.
  4. KPI-обзор за период (дважды, с детьми) — `src/app/api/admin/analytics/overview/route.ts:52`.
  5. История установки: окно 30 дней без лимита + 1000 отчётов — `src/modules/equipment/application/queries/equipment-query.service.ts:117`.

## Методика

Что и как искали:

1. Прочитаны `AGENTS.md` (модель доверия, замороженные области, «выглядит мёртвым — не удалять») и профильные
   скиллы (`pilingtrack-architecture-contract`, `pilingtrack-testing-and-evidence`).
2. Полный обход `src/`: подсчёт вызовов `findMany` по не-тестовым файлам и флаг «нет `take:` в блоке вызова» —
   эвристика (есть ложные срабатывания: передача функции как `queryFn`, спред `baseQuery`, выборки `id IN (...)`,
   ограниченные вызывающим). Скрипт: `node .../count2.js` (см. числа ниже).
3. Отдельно открыты и прочитаны: все `route.ts` в `src/app/api/**`, отдающие списки, и сервисы, которые они
   вызывают (`report-query.service`, `report-export.service`, `pile-journal-list`, `report-history-service`,
   `audit-history-service`, `equipment-query.service`, `user-service`, `user-documents`, `media-service`,
   `audit-repository` (readiness), `clearance-overview-query`, `self-clearance-query`, `cached-queries`,
   `analytics/*`, `rebuild.ts`).
4. Индексы сверены с `prisma/schema.prisma` (`@@index`/`@@unique` по нужным моделям: Report, AuditLog,
   ReadinessScoreSnapshot, BriefingRecord, UserDocument, MaintenanceRecord, FuelLog, Media, SafetyIncident,
   FeedbackEvent, Crew, Site).
5. Замороженные области (варианты экрана оператора, ORION-сайт, `src/modules/operator-mobile/**`) не
   разбирались.

Команды и их реальный вывод:

```
$ git rev-parse HEAD
fd9c103a3900daaf1fcf064e36a5d30d5b5d0816

$ grep -n "^model \|@@index\|@@unique" prisma/schema.prisma      # список моделей и индексов

$ node .../count2.js
files 956 calls 187 no-take 141
```

Толкование чисел: `964` не-тестовых файлов (первый, включая `src/generated`), `956` не-тестовых и без
`src/generated`; `187` вызовов `findMany`; из них эвристика флагует `141` без `take:` в том же блоке — это
ВЕРХНЯЯ граница, а не 141 «дыра» (в списке ниже разобраны значимые). Полный список флагов сохранён в
`C:\Users\PC\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\hermes\cache\scratch\count2.js`.

Статусы в таблицах: **ПРОЙДЕНО** — проверено чтением кода/схемы; **НЕ ПРОВЕРЕНО** — не подтверждал;
**ГИПОТЕЗА** — оценка, требующая замера.

## 10 самых опасных мест по росту

| # | severity | место (path:line) | take / курсор | макс. размер ответа | индекс под фильтр (schema.prisma) | что при ×10 данных |
|---|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` | НЕТ ни take, ни курсора | вся цепочка `AuditLog` тенанта в память | `AuditLog` @@unique([tenantId, sequence]) — сортировка по `sequence asc` покрыта; объём не ограничен | вся цепочка + построчная верификация хешей ×10 → память и CPU линейно (ГИПОТЕЗА). Вызывается на каждом открытии `readiness/audit` и при экспорте |
| 2 | критично | `src/app/api/readiness/export/route.ts:102` | НЕТ take | все `ReadinessScoreSnapshot` тенанта → CSV целиком в памяти (`:133`) | `ReadinessScoreSnapshot` @@index([tenantId, equipmentId, calculatedAt]) — при фильтре только `tenantId`+`calculatedAt` ведущий `equipmentId` не задан, индекс используется плохо | снимки добавляются на каждый пересчёт/смену; выгрузка journal-а готовности растёт линейно (ГИПОТЕЗА) |
| 3 | критично | `src/modules/reports/application/queries/report-export.service.ts:135` | НЕТ take | все отчёты тенанта с `piles`/`drillings`/`downtimes` + разложение в строки CSV/XLSX | `Report` @@index([tenantId, date]) — фильтр тенант+период покрыт | «все отчёты за всё время в память» ×10; строк CSV = отчёты × строки работ (ГИПОТЕЗА). Комментарий `raw-queries.ts:20` прямо говорит: «CSV/Excel лимита не имеют» |
| 4 | критично | `src/app/api/admin/analytics/overview/route.ts:52` (`loadPeriod`) | НЕТ take | все сданные отчёты периода ≤366 дней с детьми, вызывается дважды (`:180`–`:181`) | `Report` @@index([tenantId, date]); `status`/`siteId` в индексе отсутствуют | период ≤366 дней ×2 (текущий+прошлый) ×10 отчётов → в память уходит весь KPI (ГИПОТЕЗА) |
| 5 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:117` (и `:110`) | `:110` take 1000; `:117` НЕТ take | история 1000 отчётов + 30-дневное окно, с детьми | `Report` @@index([equipmentId]); составного (equipmentId, date) нет | карточка одной установки грузит её полную историю; при ×10 отчётов на установку — рост линейный (ГИПОТЕЗА) |
| 6 | важно | `src/services/reports/report-history-service.ts:53`–`:58` (и `:51`,`:52`) | НЕТ take | карты имён: все `user`/`site`/`equipment`/словари тенанта при каждом открытии истории отчёта | `User` @@index([tenantId]), `Site` @@index([tenantId]), `Equipment` @@index([tenantId]); `ReportAudit` @@index([reportId]) | карты = весь справочник тенанта в памяти на каждый просмотр (ГИПОТЕЗА); раньше в комментарии охарактеризовано как единственное место, где список пользователей всей системы в памяти |
| 7 | важно | `src/services/audit/audit-history-service.ts:110`–`:112` | НЕТ take | карты имён `user`/`site`/`equipment` тенанта при каждом открытии истории сущности | те же @@index([tenantId]) | то же, на каждое открытие панели истории (ГИПОТЕЗА) |
| 8 | важно | `src/modules/safety/application/clearance-overview-query.ts:205` | НЕТ take | вся история ознакомлений (`kind='INSTRUCTION'`) всех полевых работников | `BriefingRecord` @@index([tenantId, userId, recordedAt]); фильтр `kind` не индексирован (в индекс есть `type`) | история инструктажей копится годами; сводка ТБ грузит её всю (ГИПОТЕЗА) |
| 9 | важно | `src/modules/safety/application/self-clearance-query.ts:82` | НЕТ take (осознанно, см. комментарий `:78`–`:81`) | вся история ознакомлений одного работника | `BriefingRecord` @@index([tenantId, userId, recordedAt]) | у работника с длинной историей — линейный рост запроса «Мой допуск» (ГИПОТЕЗА) |
| 10 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:226`, `:283`, `:336` | НЕТ take во всех трёх | журнал ТО установки, сводка топлива за период, записи ТО за период | `MaintenanceRecord` @@index([equipmentId]), `FuelLog` @@index([equipmentId, recordedAt]) | журналы ТО/топлива копятся; карточка/сводка растёт линейно (ГИПОТЕЗА) |

## Находки

Столбцы: `# | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление`. Статус
проставлен в тексте рядом с выводом (ПРОЙДЕНО/ГИПОТЕЗА/НЕ ПРОВЕРЕНО).

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` | `auditLog.findMany({where:{tenantId, hash:{not:null}}, orderBy:[sequence asc, id asc]})` без `take`. ПРОЙДЕНО (код прочитан). | Открытие `GET /api/readiness/audit` (`readiness/audit/route.ts:32`) и выгрузка (`readiness/export/route.ts:81,114`) на каждый вызов тянут всю цепочку аудита тенанта. Лимит `:26` ограничивает только ответ (≤500), но БД-чтение — нет. ×10 = ×10 памяти и времени верификации. ГИПОТЕЗА (эффект). | Разбить чтение на страницы по `sequence` (курсор/диапазон), верифицировать цепочку постранично; для экспорта — потоковая запись. |
| 2 | критично | `src/app/api/readiness/export/route.ts:102` | `readinessScoreSnapshot.findMany(where tenantId+filters)` без `take`, затем `buildReadinessCsv` со всеми строками в памяти (`:133`). ПРОЙДЕНО. | Датасет `reports` выгрузки готовности. Снимки добавляются при каждом пересчёте/смене. Индекс `[tenantId, equipmentId, calculatedAt]` не помогает при фильтре без `equipmentId`. ГИПОТЕЗА (эффект). | Добавить `take`/период-обязательность и/или потоковую генерацию CSV; при превышении — ошибка, как в `getReportsByPeriodRaw:101`. |
| 3 | критично | `src/modules/reports/application/queries/report-export.service.ts:135` | `db.report.findMany` без `take` с `include` на `piles`/`drillings`/`downtimes`; далее `exportReportsCsv` (`:162`) и `exportReportsXlsx` (`:284`) строят файл в памяти. ПРОЙДЕНО. | Экспорт отчётов (`/api/reports/export`). Ограничения периода нет; при `filter==='withPhotos'` ещё и `media.findMany` по списку reportId. ГИПОТЕЗА (эффект). | Обязательный период + `take` с ошибкой при превышении; потоковая отдача CSV. |
| 4 | критично | `src/app/api/admin/analytics/overview/route.ts:52` | `loadPeriod` → `db.report.findMany` без `take` с `include`; вызывается дважды (`:179`–`:183`). ПРОЙДЕНО (есть потолок периода 366 дней, `:173`). | KPI-обзор. Потолок по дням есть, по числу отчётов — нет. ГИПОТЕЗА (эффект). | Агрегировать в SQL (как `getSiteAnalytics`/`getEquipmentAnalytics`), убрать материализацию детей в Node. |
| 5 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:117` | `reports30d = db.report.findMany({where:{equipmentId, date:{gte}}, status})` без `take`; рядом `:110` `allReports` take 1000. ПРОЙДЕНО. | Карточка установки `getEquipmentDetails`. `where` без `tenantId` (полагается на вызывающего/RLS). ГИПОТЕЗА (эффект). | Потолок на 30-дневное окно или агрегат в SQL; добавить `tenantId` в `where`. |
| 6 | важно | `src/services/reports/report-history-service.ts:57` (и `:53`–`:58`) | шесть `findMany` карт имён по `scope={tenantId}` без `take`; на каждое открытие истории отчёта. ПРОЙДЕНО. | Панель истории отчёта `/api/reports/[id]/history`. ГИПОТЕЗА (эффект). | Выбирать только используемые id (`id IN (...)`) вместо всей таблицы. |
| 7 | важно | `src/services/reports/report-history-service.ts:51`–`:52` | `reportAudit.findMany` и `reportVersion.findMany` по `reportId` без `take`. ПРОЙДЕНО. | История одного отчёта; версии/аудит копятся с каждой правкой. ГИПОТЕЗА (эффект). | `take` с «показать ещё»/лимит по версиям. |
| 8 | важно | `src/services/audit/audit-history-service.ts:110`–`:112` | `user`/`site`/`equipment` `findMany` по `tenantScope` без `take`; на каждое открытие истории сущности. ПРОЙДЕНО (у самого чтения событий `:104` есть `take` ≤100). | `/api/audit?scope&targetId`. ГИПОТЕЗА (эффект). | Разрешать имена только по id из найденных событий. |
| 9 | важно | `src/modules/safety/application/clearance-overview-query.ts:205` | `briefingRecord.findMany(kind='INSTRUCTION', userId IN ...)` без `take`. ПРОЙДЕНО. | Сводка ТБ `/api/safety/clearance`. ГИПОТЕЗА (эффект). | Свести в SQL (`DISTINCT ON`/агрегат) вместо выгрузки истории. |
| 10 | важно | `src/modules/safety/application/self-clearance-query.ts:82` | `briefingRecord.findMany(kind='INSTRUCTION')` без `take` для одного `userId`. ПРОЙДЕНО (комментарий `:78`–`:81` объясняет: по 20 записям считать нельзя). | «Мой допуск». Осознанное решение; риск — линейный рост. ГИПОТЕЗА (эффект). | Проекция «последняя редакция на вид инструкции» в SQL. |
| 11 | важно | `src/modules/reports/application/projections/rebuild.ts:45`, `:106`, `:111` | `report.findMany`/`site.findMany`/`siteDailySummary.findMany` без `take` по тенанту. ПРОЙДЕНО. | `/api/admin/projections/rebuild` — весь тенант в память. Операция административная/редкая, но тяжёлая. ГИПОТЕЗА (эффект). | Батчевая пересборка (по объектам/периодам). |
| 12 | важно | `src/app/api/admin/incidents/route.ts:36` | `safetyIncident.findMany` с `take: PAGE_SIZE (100)`, но без курсора. ПРОЙДЕНО. | Молчаливое усечение истории происшествий; при росте >100 неразобранных — потеря (не рост памяти). Индекс `SafetyIncident` @@index([tenantId, reviewedAt, occurredAt(sort:Desc)]) — ок. | Добавить курсор/`hasMore`. |
| 13 | мелочь | `src/lib/cached-queries.ts:40` | `crew.findMany(where:{isActive})` без `tenantId` и без `take`, кладётся под общий ключ `crews:all`; маршрут `crews/all/route.ts:25`–`:28` фильтрует тенант в памяти. ПРОЙДЕНО. | Кэш держит бригады всех тенантов; маршрут отдаёт свои. ГИПОТЕЗА (эффект). | Ключ с `tenantId` и фильтр в SQL. |
| 14 | мелочь | `src/lib/cached-queries.ts:69`–`:71` | `pileGrade`/`drillingType`/`downtimeReason` `findMany` без `take`. ПРОЙДЕНО. | Словари малы; риск низкий. | — |
| 15 | мелочь | `src/modules/sites/application/queries/site-query.service.ts:119` | `listAllSitesForAdmin` — `site.findMany` без `take`. ПРОЙДЕНО. | `/api/sites/all`. Объектов мало. Индекс `Site` @@index([tenantId, isActive]). | — |
| 16 | мелочь | `src/services/users/user-documents.ts:91`, `:126` | `userDocument.findMany` без `take` (per-user и контроль по тенанту с `expiresAt lte`). ПРОЙДЕНО (фильтр `:126` использует индекс `[tenantId, expiresAt]`). | Растёт с числом работников/документов. ГИПОТЕЗА (эффект). | — |
| 17 | мелочь | `src/core/media/media-service.ts:421` | `media.findMany` по `entityType`+`entityId` без `take`. ПРОЙДЕНО. | Ограничено числом файлов на объект. Индекс `Media` @@index([entityType, entityId]). | — |
| 18 | мелочь | `src/app/api/readiness/current/route.ts:21` | `currentReadiness.findMany` без `take` (строка на установку). ПРОЙДЕНО. | `/api/readiness/current`. Индекс `CurrentReadiness` @@index([tenantId, status, calculatedAt]). | — |
| 19 | мелочь | `src/lib/pdf-data.ts:109` | `buildFallbackCrewMap` — `crew.findMany(operatorId IN, siteId IN)` без `take`. ПРОЙДЕНО. | Размер ограничен числом отчётов периода. | — |
| 20 | мелочь | `src/services/users/user-service.ts:16` | `listAssignableUsers` — `user.findMany` без `take`. ПРОЙДЕНО. | Пользователей мало. | — |
| 21 | мелочь | `src/services/dictionaries/dictionary-service.ts:203`, `:204`, `:205`, `:218`, `:247`–`:249` | `findMany` без `take`/`select id` (usage-подсчёты). ПРОЙДЕНО. | Словари малы. | — |
| 22 | мелочь | `src/workers/unified-worker/pm-scheduler.ts:39` | `equipment.findMany` (карта имён) без `take`. ПРОЙДЕНО. | Фоновый воркер, парк тенанта. | — |
| 23 | мелочь | `src/app/api/media/download-batch/route.ts:56` | `media.findMany(id IN ids)` без `take`, но `MAX_IDS=100` (`:28`) ограничивает сверху. ПРОЙДЕНО. | Пакетная выдача ссылок. Ограничено. | — |
| 24 | мелочь | `src/services/telemetry/telemetry-ingestion-service.ts:270`, `:317`, `:411` | `equipment.findMany(id IN)` (bounded) и `telemetryRecord.findMany` с `take`-лимитом в `getTelemetryByRange`. ПРОЙДЕНО (потолок `limit` ≤1000 в `telemetry/route.ts:306`). | Поток телеметрии ограничен лимитом и обязательным `from/to` (`:310`). Индексы `TelemetryRecord` @@index([equipmentId, timestamp]) и др. | — |
| 25 | мелочь | `src/modules/safety/application/equipment-permits.ts:67` | `userEquipmentPermit.findMany` без `take` (допуски к технике). ПРОЙДЕНО. | Ограничено числом допусков. Индекс `UserEquipmentPermit` @@index([tenantId, userId]). | — |

### Проверено и признано безопасным (ПРОЙДЕНО)

- Журнал забивки: `pile-journal-list.ts:47` — `take: limit+1`, потолок `PILE_JOURNAL_EXPORT_LIMIT=20000`
  (`pile-journal-types.ts:185`), на экране `PILE_JOURNAL_LIMIT=500`; выгрузка `.xlsx` дополнительно под
  rate-limit 6/мин (`pile-passports/export/route.ts:28`, `:53`). Итоги периода — отдельным агрегатом.
- Период отчётов: `raw-queries.ts:79` `take: PERIOD_REPORTS_LIMIT+1` (2000) и явная ошибка 422 при превышении
  (`:101`–`:106`) — молчаливого среза нет.
- Списки с курсором: `reports/all/route.ts:24` (≤100), `reports/my/route.ts:19`, `users/route.ts:31`,
  `equipment/route.ts:20`, `crews/route.ts:27`, `sites` (`site-query.service.ts:63`/`:75`), `readiness/history`
  (≤500), `readiness/shifts`/`work-permits`/`defects` (≤200), `admin/analytics/site-weekly-trend` (`:25` ≤520),
  `audit` (`audit/route.ts:27` ≤200), `dlq` (`admin/dlq/route.ts:63` ≤500), `feedback` (`feedback/route.ts:65` ≤100).
- Аналитика вынесена в SQL и агрегируется в БД: `analytics/site-analytics-service.ts:78`,
  `analytics/equipment-analytics-service.ts:70` (комментарий явно про прежний риск OOM на Prisma-include).

## Не проверено

- Не выполнялись запросы к базе (нет доступа к БД/`.env`, правило «no production» из `AGENTS.md`): реальные
  объёмы таблиц, `EXPLAIN ANALYZE`, фактические размеры ответов и момент «упадёт по памяти» — **НЕ ПРОВЕРЕНО**.
  Все оценки «×10» — ГИПОТЕЗА, требующая замера на стенде с реальными данными.
- Не открывал внутренности `src/modules/reports/application/queries/pile-journal-export.ts` (сам сборщик XLSX):
  лимит строк известен из `pile-journal-types.ts:185`, но поведение при упоре в 20000 — **НЕ ПРОВЕРЕНО**.
- Замороженные области (`src/modules/operator-mobile/**`, `src/app/**/operator/**`, ORION) не разбирались по
  правилу задачи — находки там возможны, но вне рамок.
- Не проверял фактические индексы в проде (`pg_indexes`): сверка сделана по `prisma/schema.prisma`, а в проекте
  описан дрейф схемы на проде (например, `SiteWeeklyTrend.tenantId NOT NULL`) — расхождение индексов
  **НЕ ПРОВЕРЕНО**.
- Эвристика «нет take» (141 из 187 вызовов по `count2.js`) содержит ложные срабатывания и не доказывает
  отсутствие лимита у вызывающего; значимые подтверждены чтением кода, остальные — **НЕ ПРОВЕРЕНО**.
- Не оценивал нагрузку на Redis-кэш и rate-limiter при росте (вне темы «запросы списков»).
