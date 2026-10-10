# AU55-S5-INPUT-VALIDATION: какие маршруты API принимают данные без проверки схемой

Версия кода (первый проход): `e2070bd14788de5714e0ad6f0c6f0556688cb42d` — `git rev-parse HEAD`, ветка `hermes/q4-0926`.
Область: `src/app/api/**/route.ts` с методами POST/PUT/PATCH/DELETE. Только чтение; код приложения не изменялся.
Замороженные зоны (operator-варианты, сайт ORION) — по правилам пропущены, см. «Не проверено».

## Итог

Проверено 86 файлов `route.ts` с мутирующими методами (из 141 `route.ts` в `src/app/api`). Из них 75 читают тело запроса, 11 — не читают вовсе. Zod-схемой (`safeParse`) тело проверяют 68 файлов; **7 файлов читают тело без zod-схемы**. Критичных находок нет: ни один маршрут не использует непроверенные данные тела в запросе к БД или записи до проверки.

Разбивка по severity: **критично — 0, важно — 1, мелочь — 6, примечания — 2** (всего 9 пунктов + 1 примечание-справка).

Топ-5:
1. **важно** — 5 маршрутов кладут сырое тело (`unknown`) прямо в доменный санитайзер (`src/app/api/settings/route.ts:32`, `src/app/api/layout/[surfaceId]/route.ts:61`, `src/app/api/monitoring/template/route.ts:34`, `src/app/api/readiness-rules/route.ts:29`, `src/app/api/readiness/access-matrix/route.ts:35`). Проверка есть, но отложена на слой домена; на маршруте схемы нет.
2. **мелочь** — `src/app/api/telemetry/ingest/route.ts:115` (POST) и `:159` (PATCH): единственный маршрут записи телеметрии с ручной (не схемной) проверкой; поля `unit`, `timestamp`, `metadata` не проверяются по типу.
3. **мелочь** — `src/app/api/media/route.ts:27` (POST): тело принимается как TS-джерик `<T>` без runtime-схемы; `fileSize` не проверяется по типу/диапазону, тело `null` даёт 500.
4. **мелочь** — битый JSON в `reports/pdf:82`, `reports/single-pdf:64`, `feedback/events:89` возвращает 500 (а не 400): там `request.json()` без `readJsonBody`/`.catch`.
5. **мелочь** — в мутирующих обработчиках не валидируются query-параметры: `sites/[id]/assign:46` (`userId`) и `layout/[surfaceId]:58,84` (`entityId`).

## Методика

Поиск по коду (рипгрэп через инструмент поиска и узловые скрипты на Node, т.к. Python в окружении нет):

- Перечень маршрутов: `search_files target=files pattern=route.ts path=src/app/api` → 141 `route.ts`.
- Классификация (тело/схема/`.data`/params/query) — Node-скрипт, обходящий `src/app/api`, для каждого файла проверяющий регулярками экспорт методов и наличие `request.json(`/`readJsonBody<...>(`, `.safeParse(`, `.data`, `await params`, `searchParams.get(`. Команда-эквивалент:
  `node <scratch>/au55-count.js` (обход `src/app/api`, фильтр `export (async) (function|const) (POST|PUT|PATCH|DELETE)`).
  Результат: `files with mutation methods: 86`, `read request body: 75`, `use zod safeParse: 68`, `NO zod safeParse: 18 (of them read body: 7)`, `no body read: 11`.
- Построение полной таблицы: `node <scratch>/gen-table.js` → колонки «path:line | метод | тело | zod safeParse | .data | params | query». В таблицу попал номер строки первого `safeParse` (для маршрутов со схемой) — это и есть «файл:строка» проверки.
- Все найденные «без zod, но с телом» файлы прочитаны целиком и прослежены в доменный слой (`sanitizeSettings`, `sanitizeRuleSet`, `sanitizeAccessMatrix`, `surface.validate`, `validateTelemetry`, ручные проверки `media/route`).
- Проверена обработка ошибок обёрток: `src/core/api-wrapper.ts:107-133` (маппинг в статусы) и `:162-168` (`readJsonBody` → 400 на битом JSON).
- `safeParse` подтверждён как валидация по факту вызова и по последующему использованию `parsed.data`/`validated.data`/`validation.data` (ручная сверка по каждому файлу с таблицей).

Ключевые строки, на которых держатся выводы (файл:строка открыты и прочитаны):
`src/core/api-wrapper.ts:62`, `:107`, `:119`, `:130`, `:162`, `:178`, `:221`.

Оговорка по колонке «query» в таблице: она отражает наличие `searchParams.get(` в ФАЙЛЕ, а не в конкретном мутирующем обработчике (в файле рядом часто есть GET). Для мутаций query реально читают только `admin/projections/rebuild` (`name`, валидируется по массиву `VALID`), `layout` (`entityId`), `sites/[id]/assign` (`userId`), `reports/pdf` (`inline`) — это учтено в находках.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как исправить |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/settings/route.ts:32`; `src/app/api/layout/[surfaceId]/route.ts:61`; `src/app/api/monitoring/template/route.ts:34`; `src/app/api/readiness-rules/route.ts:29`; `src/app/api/readiness/access-matrix/route.ts:35` | Тело читается (`request.json()`) и передаётся в доменную функцию как `unknown` без zod-схемы на маршруте. Валидация — внутри домена (`sanitizeSettings` `settings/domain/settings.ts:120`, `surface.validate` `layout/domain/surfaces.ts:52`, `sanitizeRuleSet` `readiness/domain/readiness-rules.ts:248`, `sanitizeAccessMatrix` `readiness/domain/access-matrix.ts:63`). Статус проверки: **ПРОЙДЕНО** (данные проверяются), но на маршрутном слое защиты нет. | Если санитайзер забудет новое поле, оно уйдёт в БД как есть; расхождение «маршрут проверяет» vs «домен проверяет» затрудняет ревью. | Добавить на маршрут `schema.safeParse(body)` + 400 и передавать `validated.data` (как в остальных 68 маршрутах). |
| 2 | мелочь | `src/app/api/telemetry/ingest/route.ts:115` (POST), `:159` (PATCH) | Единственная запись телеметрии с ручной проверкой `validateTelemetry` (`:211`), а не схемой. Проверяются `type`, `value`, `latitude`, `longitude`. НЕ проверяются типы `unit`, `timestamp`, `metadata`. | `metadata` уходит в `telemetryRecord.createMany` как JSON без разбора (`:323,332`); `timestamp: new Date(r.timestamp)` при мусоре даёт `Invalid Date`. Устройство аутентифицировано ключом (`:60-89`), поэтому риск ограничен. | Описать zod-схему записи (как `telemetryRecordSchema` в `telemetry/route.ts:26`) и проверять `timestamp`/`unit`/`metadata`. |
| 3 | мелочь | `src/app/api/media/route.ts:27` (POST) | Тело типизировано джерик-типом `<{fileName?,...}>` (компиляторная, но не runtime-проверка); вручную проверяются только `fileName` и `contentType` (`:35`). `fileSize`, `entityType`, `entityId` типом не ограничены. Комментарий `:24-26` говорит «схемы zod тут нет» намеренно. | `fileSize` не проверяется как число/диапазон; тело `null`/не-объект даёт `TypeError` → 500 (`api-wrapper.ts:130`), а не 400. | Либо zod-схема, либо явная проверка `typeof body === 'object' && body !== null` и типа `fileSize`. |
| 4 | мелочь | `src/app/api/reports/pdf/route.ts:82`; `src/app/api/reports/single-pdf/route.ts:64`; `src/app/api/feedback/events/route.ts:89` | `await request.json()` без `readJsonBody`/`.catch`. `SyntaxError` от битого JSON не маппится в 400 (`api-wrapper.ts:107-133`), а уходит в общую ветку → 500 и событие в Sentry. | Клиент с кривым телом получает «Внутренняя ошибка сервера» вместо 400 — шум в Sentry, ложное «сервер лежит». | Заменить на `readJsonBody(request)` (даёт 400) либо обернуть в try→400. |
| 5 | мелочь | `src/app/api/sites/[id]/assign/route.ts:46` (DELETE) | Query-параметр `userId` читается `searchParams.get('userId')` и передаётся как `userId || ''` без валидации. | Пустой/чужой формат уходит в `unassignUserFromSite`; сейчас спасает проверка на уровне команды, но маршрут не отсекает мусор. | Проверить `z.string().min(1)` или 400 при отсутствии параметра. |
| 6 | мелочь | `src/app/api/layout/[surfaceId]/route.ts:58` (PUT), `:84` (DELETE) | Query-параметр `entityId` берётся из URL и входит в составной ключ (`tenantId_surfaceId_entityId`) без проверки длины/формата. | Значение — часть ключа `moduleLayoutTemplate`; валидации только по смыслу нет, ограничивает лишь композитный ключ Prisma. | Ограничить длину/формат `entityId` (например `z.string().max(100)`). |
| 7 | мелочь | `src/app/api/feedback/events/route.ts:90` | `const operation = body.operation;` читается из сырого тела (`:89`) ДО `safeParse` (`:99`, `:138`) — используется для ветвления. | Значение используется только в сравнениях равенства (`read_all`/`read`/`acknowledge`), в БД/запросы до валидации не попадает. Формально — «данные до проверки». | Начать с `const parsed = feedbackRequestSchema.safeParse(body)`, ветвиться по проверенному полю. |
| 8 | мелочь | `src/app/api/inspections/route.ts:62` | Выбор схемы по форме сырого тела: `'level' in body && !('templateId' in body)`. | Ветвление по ключам до валидации; обе ветви затем проверяются (`:64`), значение ключей в запрос не идёт. Безопасно, но хрупко. | Различать варианты одним union-схемом или явным полем-дискриминатором. |
| 9 | примечание | все 86 файлов | Динамические сегменты (`[id]`, `[docId]`, `[readingId]`, `[surfaceId]`…) нигде не проверяются схемой: `const { id } = await params` → сразу в tenant-scoped Prisma. Пример: `src/app/api/sites/[id]/hierarchy/route.ts:119`. | Не дефект: id ограничен типом Prisma/составным ключом и тенантным фильтром. Отмечено как единый паттерн для карты рисков. | По желанию: `z.string().min(1)` на сегмент. |
| 10 | примечание-справка | 68 файлов | Все маршруты со схемой используют результат проверки (`parsed.data`/`validated.data`/`validation.data`), а не сырое тело. Явно проверено и в исторически «чинившемся» `reports/admin-upsert/route.ts:32-38` (комментарий подтверждает отказ от сырого `dto`). | Подтверждает, что «схема есть, но данные берут из тела» нигде не встречается. | — |

### Полная таблица маршрутов (86 с POST/PUT/PATCH/DELETE)

`path:line` — строка первого `safeParse` (место проверки схемы); `тело` — как читается тело; `zod` — есть ли `safeParse`; `.data` — используется ли результат; `params` — читает динамический сегмент; `query` — есть ли `searchParams.get(` в файле.

| path:line | метод | тело | zod safeParse | .data | params | query |
|---|---|---|---|---|---|---|
| src/app/api/admin/dlq/route.ts:114 | POST | readJsonBody | да | да | — | да |
| src/app/api/admin/incidents/route.ts:109 | POST | json | да | да | — | да |
| src/app/api/admin/projections/rebuild/route.ts | POST | — | НЕТ | - | — | да |
| src/app/api/alerts/webhook/route.ts:95 | POST | json | да | да | — | — |
| src/app/api/assistant/command/route.ts:43 | POST | json | да | да | — | — |
| src/app/api/auth/login/route.ts:34 | POST | readJsonBody | да | да | — | — |
| src/app/api/auth/logout/route.ts | POST | — | НЕТ | - | — | — |
| src/app/api/briefings/[id]/sign/route.ts | POST | — | НЕТ | - | id | — |
| src/app/api/briefings/route.ts:40 | POST | json | да | да | — | — |
| src/app/api/checklist-templates/[id]/route.ts:73 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/checklist-templates/route.ts:67 | POST | readJsonBody | да | да | — | да |
| src/app/api/crews/[id]/route.ts:45 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/crews/route.ts:45 | POST | readJsonBody | да | да | — | да |
| src/app/api/dictionary/manage/route.ts:103 | POST/PATCH/DELETE | readJsonBody | да | да | — | да |
| src/app/api/equipment/[id]/device-keys/route.ts:75 | POST/DELETE | readJsonBody | да | да | id | — |
| src/app/api/equipment/[id]/documents/[docId]/route.ts:42 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/equipment/[id]/documents/route.ts:37 | POST | readJsonBody | да | да | id | — |
| src/app/api/equipment/[id]/fuel/[entryId]/route.ts | DELETE | — | НЕТ | - | id | — |
| src/app/api/equipment/[id]/fuel/route.ts:89 | POST | readJsonBody | да | да | id | да |
| src/app/api/equipment/[id]/maintenance/[recordId]/route.ts:53 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/equipment/[id]/maintenance/route.ts:64 | POST | readJsonBody | да | да | id | — |
| src/app/api/equipment/[id]/meter-readings/[readingId]/route.ts | DELETE | — | НЕТ | - | id | — |
| src/app/api/equipment/[id]/meter-readings/route.ts:74 | POST | readJsonBody | да | да | id | — |
| src/app/api/equipment/[id]/route.ts:71 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/equipment/route.ts:41 | POST | readJsonBody | да | да | — | да |
| src/app/api/feedback/events/route.ts:99 | POST/PATCH | json | да | да | — | да |
| src/app/api/inspections/[id]/complete/route.ts:26 | POST | readJsonBody | да | да | id | — |
| src/app/api/inspections/[id]/route.ts:56 | PUT | readJsonBody | да | да | id | — |
| src/app/api/inspections/route.ts:64 | POST | readJsonBody | да | да | — | да |
| src/app/api/layout/[surfaceId]/route.ts | PUT/DELETE | json | НЕТ | - | id | да |
| src/app/api/maintenance-plans/[id]/route.ts:38 | PATCH/DELETE | readJsonBody | да | да | id | — |
| src/app/api/maintenance-plans/route.ts:60 | POST | readJsonBody | да | да | — | да |
| src/app/api/maintenance-plans/run/route.ts | POST | — | НЕТ | - | — | — |
| src/app/api/maintenance/[id]/accept/route.ts | POST | — | НЕТ | - | id | — |
| src/app/api/media/[id]/confirm/route.ts | POST | — | НЕТ | - | id | — |
| src/app/api/media/[id]/route.ts | DELETE | — | НЕТ | - | id | — |
| src/app/api/media/route.ts | POST | readJsonBody | НЕТ | - | — | да |
| src/app/api/monitoring/template/route.ts | PUT | json | НЕТ | - | — | — |
| src/app/api/notifications/telegram/test/route.ts:32 | POST | readJsonBody | да | да | — | — |
| src/app/api/operator/mobile/command/route.ts:199 | POST | json | да | да | — | — |
| src/app/api/orion/lead/route.ts:71 | POST | json | да | да | — | — |
| src/app/api/pile-passports/[id]/decide/route.ts:33 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness-rules/publish/route.ts | POST | — | НЕТ | - | — | — |
| src/app/api/readiness-rules/route.ts | PUT | json | НЕТ | - | — | — |
| src/app/api/readiness/access-matrix/route.ts | POST/PUT | json | НЕТ | - | — | — |
| src/app/api/readiness/defects/[id]/reject/route.ts:15 | POST | json | да | да | id | — |
| src/app/api/readiness/defects/[id]/resolve/route.ts:15 | POST | json | да | да | id | — |
| src/app/api/readiness/defects/[id]/triage/route.ts:15 | POST | json | да | да | id | — |
| src/app/api/readiness/defects/route.ts:33 | POST | json | да | да | — | — |
| src/app/api/readiness/handovers/[id]/accept/route.ts:10 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/handovers/[id]/rework/route.ts:9 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/place-presets/route.ts:33 | POST/DELETE | json | да | да | — | да |
| src/app/api/readiness/shifts/[id]/cancel/route.ts:12 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/[id]/decline/route.ts:14 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/[id]/handover/route.ts:12 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/[id]/request-acceptance/route.ts:12 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/[id]/route.ts:27 | PATCH | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/[id]/start/route.ts:13 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/[id]/waiver/route.ts:17 | POST | readJsonBody | да | да | id | — |
| src/app/api/readiness/shifts/route.ts:47 | POST | json | да | да | — | — |
| src/app/api/readiness/work-permits/[id]/approve/route.ts:15 | POST | json | да | да | id | — |
| src/app/api/readiness/work-permits/[id]/revoke/route.ts:15 | POST | json | да | да | id | — |
| src/app/api/readiness/work-permits/[id]/route.ts:38 | PATCH | json | да | да | id | — |
| src/app/api/readiness/work-permits/[id]/submit/route.ts:15 | POST | json | да | да | id | — |
| src/app/api/readiness/work-permits/route.ts:65 | POST | json | да | да | — | — |
| src/app/api/reports/admin-upsert/route.ts:25 | POST | readJsonBody | да | да | — | — |
| src/app/api/reports/delete/route.ts:52 | DELETE | json | да | да | — | — |
| src/app/api/reports/pdf/route.ts:83 | POST | json | да | да | — | да |
| src/app/api/reports/single-pdf/route.ts:65 | POST | json | да | да | — | да |
| src/app/api/reports/upsert/route.ts:26 | POST | readJsonBody | да | да | — | — |
| src/app/api/safety/equipment-permits/[id]/route.ts | DELETE | — | НЕТ | - | id | — |
| src/app/api/safety/equipment-permits/route.ts:73 | POST | json | да | да | — | да |
| src/app/api/settings/route.ts | PUT | json | НЕТ | - | — | — |
| src/app/api/sites/[id]/assign/route.ts:24 | POST/DELETE | readJsonBody | да | да | id | да |
| src/app/api/sites/[id]/hierarchy/route.ts:60 | POST/DELETE | readJsonBody | да | да | id | — |
| src/app/api/sites/[id]/route.ts:44 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/sites/create/route.ts:24 | POST | readJsonBody | да | да | — | — |
| src/app/api/telegram/configs/route.ts:66 | POST/PUT/DELETE | readJsonBody | да | да | — | — |
| src/app/api/telemetry/batch/route.ts:114 | POST | readJsonBody | да | да | — | — |
| src/app/api/telemetry/ingest/route.ts | POST/PATCH | readJsonBody | НЕТ | - | — | — |
| src/app/api/telemetry/route.ts:135 | POST | readJsonBody | да | да | — | да |
| src/app/api/user-document-types/[id]/route.ts:20 | PATCH/DELETE | readJsonBody | да | да | id | — |
| src/app/api/user-document-types/route.ts:47 | POST | readJsonBody | да | да | — | да |
| src/app/api/users/[id]/documents/[docId]/route.ts:37 | PUT/DELETE | readJsonBody | да | да | id | — |
| src/app/api/users/[id]/documents/route.ts:65 | POST | readJsonBody | да | да | id | — |
| src/app/api/users/route.ts:58 | POST/PUT/DELETE | json | да | да | — | да |

Строки «НЕТ zod / тело = —» (`auth/logout`, `media/[id]`, `media/[id]/confirm`, `briefings/[id]/sign`, `equipment/[id]/fuel/[entryId]`, `equipment/[id]/meter-readings/[readingId]`, `maintenance-plans/run`, `maintenance/[id]/accept`, `safety/equipment-permits/[id]`, `readiness-rules/publish`, `admin/projections/rebuild`) — тело запроса не читают, поэтому схемная проверка тела им не нужна; их вход — только путь/query/заголовки.

## Не проверено

- Сайт ORION и `src/app/api/orion/**` — замороженная зона: `src/app/api/orion/lead/route.ts` попал в общий перечень (в таблице), но по правилам не анализировался; в выводы не включён.
- GET-маршруты не проверялись (задача только про POST/PUT/PATCH/DELETE), кроме мест, где query мутации пересекается с находками.
- Содержимое чужих отчётов в `docs/audits/**` (включая `36-route-validation.md`, `W97-API-BODY-SAFEPARSE.md`) не открывалось — независимость первого прохода.
- Не запускались тесты/lint/tsc и `npm run build` — задача read-only и не требует сборки; типовые/рантайм-эффекты находок 1-8 не воспроизводились на живом сервере (статус «ГИПОТЕЗА» там, где вывод из чтения кода, а не из прогона).
- Полнота валидации внутри доменных `sanitize*`/`validate*` проверена по верхнему уровню (какие поля отбираются), но не по всем вложенным структурам (`criteria`/`grants`/`notifications`) на исчерпывающем списке полей — глубинная проверка санитайзеров не проводилась.
- Не проверялось, покрывают ли `*.test.ts(x)`/e2e проверку этих маршрутов (вне рамок задания).
